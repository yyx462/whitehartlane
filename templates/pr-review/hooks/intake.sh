#!/usr/bin/env bash
# intake — the review's materializer (a gate: the rail ACTS, once).
# Builds everything a reviewer reads: two detached checkouts (BASE for
# prove's introduced-vs-preexisting split, HEAD for hunting and repros),
# the diff, the file list, pr.md (the claims WITHOUT the author's
# reasoning — fresh context is the whole point), one shuffled hunk order
# per lens (same diff, different first attention), and deps when they
# fit the budget. No verdict lives here; infra failure = nonzero.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
# data/ is the door-staged carrier: everything hooks and briefs read
# lives under it, so the run dir is self-contained wherever it lands
. "$prog/data/review/config.sh"

need() { command -v "$1" >/dev/null 2>&1 || { echo "intake: missing tool: $1" >&2; exit 1; }; }
need git; need node

# idempotent re-entry (a regrade re-fires the gate): drop old
# checkouts, THEN prune git's now-stale registrations (prune before rm
# leaves the metadata and the next `worktree add` dies with 128)
for side in head base; do
  if [ -e "$prog/data/review/$side" ]; then
    rm -rf "$prog/data/review/$side"
  fi
done
git -C "$REPO" worktree prune >/dev/null 2>&1 || true

# resolve + verify the two ends (the CLI resolved them once; a moved
# repo or rebased branch must fail HERE, loudly, not mid-lens)
for pair in "BASE:$BASE_SHA" "HEAD:$HEAD_SHA"; do
  side="${pair%%:*}"; sha="${pair##*:}"
  git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null || {
    echo "intake: $side sha $sha is not a commit in $REPO" >&2; exit 1; }
done

git -C "$REPO" worktree add --detach "$prog/data/review/head" "$HEAD_SHA" >/dev/null
git -C "$REPO" worktree add --detach "$prog/data/review/base" "$BASE_SHA" >/dev/null

# the diff + file list
git -C "$REPO" diff "$BASE_SHA" "$HEAD_SHA" > "$prog/data/review/diff.patch"
git -C "$REPO" diff --name-only "$BASE_SHA" "$HEAD_SHA" > "$prog/data/review/files.txt"

# pr.md — the claims, not the story. The body (when the CLI was given
# one) is claims the author WROTE ABOUT THE CODE; the author's session
# transcript never rides along.
{
  echo "# $TITLE"
  echo
  echo "BASE $BASE_SHA  <-  HEAD $HEAD_SHA"
  echo
  sed 's/^/- /' "$prog/data/review/files.txt"
  if [ -f "$prog/data/review/pr-body.md" ]; then
    echo; cat "$prog/data/review/pr-body.md"
  fi
} > "$prog/data/review/pr.md"

# one shuffled hunk order per lens (Bugbot's randomized-order finding:
# order changes what a model attends to first). Fixed seeds: the same
# review is reproducible; different lenses still diverge. The shuffle
# is BLOCK-SAFE (the self-review's momentum-1/questions-1/tests-1, all
# three proven): file headers stay glued to their own hunks — shuffling
# "every line after the first @@" mangles multi-file diffs by folding
# the next file's header into the previous hunk.
shuffle_order() { # $1 seed
  node -e '
    const seed = Number(process.argv[1])
    const text = require("node:fs").readFileSync(0, "utf8")
    let rng = seed
    const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648 }
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
    const files = []
    let cur = null
    for (const line of text.split("\n")) {
      if (line.startsWith("diff --git ")) { cur = { head: [line], hunks: [] }; files.push(cur); continue }
      if (cur === null) continue
      if (line.startsWith("@@ ")) cur.hunks.push([line])
      else if (cur.hunks.length > 0) cur.hunks[cur.hunks.length - 1].push(line)
      else cur.head.push(line)
    }
    const out = []
    for (const f of shuffle(files)) {
      out.push(...f.head)
      for (const h of shuffle(f.hunks)) out.push(...h)
    }
    console.log(out.join("\n"))
  ' "$1" < "$prog/data/review/diff.patch"
}
i=0
# the roster is the materialized units, never the hardcoded four (the
# gate materializes subsets); dead order files for absent lenses were
# harmless dead weight — this reads the truth instead
# the lens derivation — ONE reader, extracted verbatim by
# test/review/principles-26.test.ts (marker-delimited: edit the
# pipeline here, never in the test — the test runs these exact bytes)
# :lens-derivation-start
lenses=$({ sed -n '/^units = \[/,/^\]/p' "$prog/workflow.toml" | grep -o '{ id = "[a-z]*"' | sed 's/.*id = "//;s/"//'
  # the [[stage.units]] array-of-tables form — the door's parsed reader
  # accepts and materializes it (gate-r5 principles-26); the textual
  # reader must derive the same lenses or every lens silently loses
  # its shuffled hunk order. Stateful awk (a sed range consumes each
  # next header as its own end and drops the second unit's id).
  awk '/^\[\[stage\.units\]\]/ { inb = 1; next } /^\[/ { inb = 0 } inb && /^id = "[a-z]*"/ { sub(/^id = "/, ""); sub(/"$/, ""); print }' "$prog/workflow.toml"
} | awk '!seen[$0]++')
# :lens-derivation-end
for lens in $lenses; do
  i=$((i+1))
  shuffle_order "$((7 * i + 13))" > "$prog/data/review/order-$lens.txt"
done

# repro home + deps. Install is BUDGET-CAPPED and runs BOTH SIDES IN
# PARALLEL (self-review r5 momentum-1: 150s serial × 2 = 300s cannot
# fit the gate's own 300s cap — the promised degradation was
# unreachable and a slow install killed the whole review as infra).
# A repo whose install cannot fit degrades honestly (repros that need
# deps will fail to load and prove downgrades them to bogus/advisory —
# never a silent wrong verdict).
mkdir -p "$prog/data/review/head/test/review"
install_pids=()
for side in head base; do
  if [ -f "$prog/data/review/$side/package.json" ]; then
    if command -v timeout >/dev/null 2>&1; then TO="timeout 150"; else TO=""; fi
    (cd "$prog/data/review/$side" && $TO npm ci --prefer-offline --no-audit --no-fund >/dev/null 2>&1) \
      || echo "$side: deps install degraded (repros needing node_modules will classify bogus, not block)" >> "$prog/data/review/intake.log" &
    install_pids+=($!)
  fi
done
for pid in "${install_pids[@]:-}"; do wait "$pid" 2>/dev/null || true; done

echo "intake ok: $(wc -l < "$prog/data/review/files.txt" | tr -d ' ') files, $(grep -c '^@@' "$prog/data/review/diff.patch" || true) hunks"
