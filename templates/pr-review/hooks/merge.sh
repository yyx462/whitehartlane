#!/usr/bin/env bash
# merge — the final, deliberately cold verdict (gate). Accept: run the
# configured merge (MERGE_CMD, or the local default — checkout the base
# branch and --no-ff the head). Reject: exit 1 with the summary — the
# chain fails honestly, the report goes red, and the wake carries why.
# The one place in the review that decides without a mind.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
. "$prog/data/review/config.sh"
node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.verdict)' "$prog/data/review/verdict.json" \
  | { read -r verdict
case "$verdict" in
  accept)
    if [ -n "${MERGE_CMD:-}" ]; then
      sh -c "$MERGE_CMD" || { echo "merge: MERGE_CMD failed" >&2; exit 1; }
    else
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
