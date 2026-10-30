#!/usr/bin/env bash
# merge — the final, deliberately cold verdict (gate). Accept: run the
# configured merge (MERGE_CMD, or the local default — checkout the base
# branch and --no-ff the head). Reject: exit 1 with the summary — the
# chain fails honestly, the report goes red, and the wake carries why.
# The one place in the review that decides without a mind. It is also
# the last stage, so it owns the DEMATERIALIZATION (2026-10-30, the
# drift receipt: 69 review jobs left 138 detached registrations in the
# repo's git metadata — intake materializes, nothing dematerialized,
# and agentic-os keeps job dirs forever so intake's re-entry prune
# never fired). The checkouts are regenerable from the SHAs; every
# other receipt (verdict.json, findings, feedback/, diff.patch) stays.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
. "$prog/data/review/config.sh"

# teardown — runs on EVERY exit (accept, reject, refuse): a rejected
# review leaks too. The divide brief's ADOPT instruction cites repro
# paths under test/review/, so they ride out to data/review/repros/
# before the checkout goes — feedback stays resolvable. The order is
# intake's own re-entry law inverted: rm the dirs FIRST, prune AFTER
# (prune before rm leaves the metadata and the next `worktree add`
# dies with 128). Teardown is INFRA: every step is guarded, it never
# changes the verdict, and a teardown failure is stderr noise, never
# a failed review.
teardown() {
  if [ -d "$prog/data/review/head/test/review" ]; then
    rm -rf "$prog/data/review/repros"
    mkdir -p "$prog/data/review/repros/test"
    cp -R "$prog/data/review/head/test/review" "$prog/data/review/repros/test/review" 2>/dev/null || true
  fi
  for side in head base; do
    if [ -e "$prog/data/review/$side" ]; then
      rm -rf "$prog/data/review/$side"
    fi
  done
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
}
trap teardown EXIT

node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.verdict)' "$prog/data/review/verdict.json" \
  | { read -r verdict
case "$verdict" in
  accept)
    if [ -n "${MERGE_CMD:-}" ]; then
      sh -c "$MERGE_CMD" || { echo "merge: MERGE_CMD failed" >&2; exit 1; }
    else
      # the review judged BASE_SHA..HEAD_SHA (self-review r8b
      # momentum-1): a base BRANCH that moved since intake would land
      # unreviewed commits inside the accepted merge — re-observe the
      # label and refuse on drift
      now_base=$(git -C "$REPO" rev-parse "$BASE_BRANCH")
      if [ "$now_base" != "$BASE_SHA" ]; then
        echo "merge: base $BASE_BRANCH moved ($BASE_SHA -> $now_base) since the review — re-run the review on the new base" >&2
        exit 1
      fi
      git -C "$REPO" checkout -q "$BASE_BRANCH" || { echo "merge: cannot checkout $BASE_BRANCH" >&2; exit 1; }
      git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept $TITLE" "$HEAD_SHA" \
        || { echo "merge: git merge failed (conflicts? base moved?)" >&2; exit 1; }
    fi
    echo "merge: accepted — $TITLE ($HEAD_SHA) merged"
    ;;
  reject)
    n=$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.blocked.length)' "$prog/data/review/verdict.json")
    echo "merge: REJECTED — $n proven finding(s); feedback/ names the responsible parties; verdict at data/review/verdict.json" >&2
    exit 1
    ;;
  *)
    echo "merge: verdict.json says '$verdict' — refuse, never guess" >&2
    exit 1
    ;;
esac; }
