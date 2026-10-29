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
# THE REPRO CORPUS RIDES, THE READING DOES NOT (2026-10-30, the user's
# convergence verdict): every lens re-read a 25k-line diff of which
# 21k was test/review/ — the adopted repros. In 33 rounds that corpus
# generated exactly ONE finding (r2, a suite test asserting the wrong
# thing) while costing the round its context budget — the lenses
# stall near limits reading proof they already trust: the suite RUNS
# every repro on every round (the prove gate + npm test), which is
# the regression guarantee. The lens diff excludes the corpus; the
# checkouts above keep every file (prove re-runs the repros from the
# checkout, and a lens MAY still open a specific repro by path when
# a finding cites one).
git -C "$REPO" diff "$BASE_SHA" "$HEAD_SHA" -- . ':(exclude)test/review' > "$prog/data/review/diff.patch"
git -C "$REPO" diff --name-only "$BASE_SHA" "$HEAD_SHA" -- . ':(exclude)test/review' > "$prog/data/review/files.txt"

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
# THE ONE READER (gate-r17 — the design replacement the grammar grind
# forced): the door's own smol-toml parse derived the lens roster ONCE
# at materialization into data/review/lenses.txt; this hook READS the
# handoff — it does not re-derive from TOML text. Every textual
# re-derivation (sed/grep/awk) stayed one legal spelling behind the
# grammar forever: quotes, padding, key order, quoted keys, trailing
# comments, spaced headers, braces in briefs — one silent miss each.
# A missing or empty handoff is a door bug: REFUSE, never silently
# derive nothing (a lens without its order file reads diff.patch in
# the shared native order — the correlated first-attention the
# shuffle exists to kill).
if [ ! -s "$prog/data/review/lenses.txt" ]; then
  echo "intake: $prog/data/review/lenses.txt is missing or empty — the door did not hand off the lens roster (this is a door bug; report it)" >&2
  exit 1
fi
lenses=$(cat "$prog/data/review/lenses.txt")
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
