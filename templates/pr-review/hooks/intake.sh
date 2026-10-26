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
. "$prog/review/config.sh"

need() { command -v "$1" >/dev/null 2>&1 || { echo "intake: missing tool: $1" >&2; exit 1; }; }
need git; need node; need awk

# idempotent re-entry (a regrade re-fires the gate): drop old checkouts
git -C "$REPO" worktree prune >/dev/null 2>&1 || true
for side in head base; do
  if [ -e "$prog/review/$side" ]; then
    rm -rf "$prog/review/$side"
  fi
done
mkdir -p "$prog/review"

# resolve + verify the two ends (the CLI resolved them once; a moved
# repo or rebased branch must fail HERE, loudly, not mid-lens)
for pair in "BASE:$BASE_SHA" "HEAD:$HEAD_SHA"; do
  side="${pair%%:*}"; sha="${pair##*:}"
  git -C "$REPO" cat-file -e "$sha^{commit}" 2>/dev/null || {
    echo "intake: $side sha $sha is not a commit in $REPO" >&2; exit 1; }
done

git -C "$REPO" worktree add --detach "$prog/review/head" "$HEAD_SHA" >/dev/null
git -C "$REPO" worktree add --detach "$prog/review/base" "$BASE_SHA" >/dev/null

# the diff + file list
git -C "$REPO" diff "$BASE_SHA" "$HEAD_SHA" > "$prog/review/diff.patch"
git -C "$REPO" diff --name-only "$BASE_SHA" "$HEAD_SHA" > "$prog/review/files.txt"

# pr.md — the claims, not the story. The body (when the CLI was given
# one) is claims the author WROTE ABOUT THE CODE; the author's session
# transcript never rides along.
{
  echo "# $TITLE"
  echo
  echo "BASE $BASE_SHA  <-  HEAD $HEAD_SHA"
  echo
  sed 's/^/- /' "$prog/review/files.txt"
  if [ -f "$prog/review/pr-body.md" ]; then
    echo; cat "$prog/review/pr-body.md"
  fi
} > "$prog/review/pr.md"

# one shuffled hunk order per lens (Bugbot's randomized-order finding:
# order changes what a model attends to first). Fixed seeds: the same
# review is reproducible; different lenses still diverge.
shuffle_order() { # $1 seed
  awk -v seed="$1" '
    BEGIN { srand(seed); n = 0; pre = "" }
    /^@@/ { n++; hunks[n] = ""; next }
    n == 0 { pre = pre $0 "\n"; next }
    { hunks[n] = hunks[n] $0 "\n" }
    END {
      for (i = n; i > 1; i--) {
        j = int(rand() * i) + 1; t = hunks[i]; hunks[i] = hunks[j]; hunks[j] = t
      }
      printf "%s", pre
      for (i = 1; i <= n; i++) printf "%s", hunks[i]
    }' "$prog/review/diff.patch"
}
i=0
for lens in principles tests momentum questions; do
  i=$((i+1))
  shuffle_order "$((7 * i + 13))" > "$prog/review/order-$lens.txt"
done

# repro home + deps. Install is BUDGET-CAPPED: a repo whose install
# cannot fit the gate's cap degrades honestly (repros that need deps
# will fail to load and prove downgrades them to bogus/advisory —
# never a silent wrong verdict).
mkdir -p "$prog/review/head/test/review"
for side in head base; do
  if [ -f "$prog/review/$side/package.json" ]; then
    if command -v timeout >/dev/null 2>&1; then TO="timeout 150"; else TO=""; fi
    (cd "$prog/review/$side" && $TO npm ci --prefer-offline --no-audit --no-fund >/dev/null 2>&1) \
      || echo "$side: deps install degraded (repros needing node_modules will classify bogus, not block)" >> "$prog/review/intake.log"
  fi
done

echo "intake ok: $(wc -l < "$prog/review/files.txt" | tr -d ' ') files, $(grep -c '^@@' "$prog/review/diff.patch" || true) hunks"
