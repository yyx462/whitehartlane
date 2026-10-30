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
    # the fixer's exit (the 2026-10-30 ruling): the reviewer reminds, the
    # owner decides. Fix what you accept; after round 1 you may REJECT
    # THE REJECTION — every blocked finding answered with a one-line why,
    # merged under a recorded override, never stealth
    echo "merge: the fixer's exit — fix + adopt the repros, or (after round 1) overrule: whl ship <repo> --pr <n> --overrule <file.json> (every blocked finding answered, receipt on the PR)" >&2
    exit 1
    ;;
  *)
    echo "merge: verdict.json says '$verdict' — refuse, never guess" >&2
    exit 1
    ;;
esac; }
