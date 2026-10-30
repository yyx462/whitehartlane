#!/usr/bin/env bash
# merge — the final, deliberately cold verdict (gate). Accept: run the
# configured merge (MERGE_CMD, or the local default — checkout the base
# branch and --no-ff the head). Reject: exit 1 with the summary — the
# chain fails honestly, the report goes red, and the wake carries why.
# The one place in the review that decides without a mind.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
. "$prog/data/review/config.sh"

# THE OUTCOME MARKER (principles-4004): the commission ends with THIS
# stage — the verdict the prove stage wrote lands two stages earlier,
# so a watcher waiting on the verdict speaks before the feedback map
# exists and before the merge ran. The merge stage writes the
# commission's end into the STAGED program dir, and the watcher waits
# on exactly that seat.
outcome() { # $1 = accept|reject
  local payload
  payload="{\"outcome\":\"$1\",\"head\":\"${HEAD_SHA:-}\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  # the run's own copy (the job's run dir — the rail's record)
  printf '%s\n' "$payload" >>"$prog/data/review/merge.json" 2>/dev/null || true
  # and the STAGED program's seat (where the watcher waits)
  local seat="${STAGED_DIR:-$prog}/data/review/merge.json"
  mkdir -p "$(dirname "$seat")" 2>/dev/null || true
  printf '%s\n' "$payload" >"$seat" 2>/dev/null || true
}
node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.verdict)' "$prog/data/review/verdict.json" \
  | { read -r verdict
case "$verdict" in
  accept)
    if [ -n "${MERGE_CMD:-}" ]; then
      # THE HEAD-DRIFT GUARD (momentum-902, the base twin): the
      # MERGE_CMD arm merges the PR's CURRENT head — a push during the
      # review would land bytes no verdict judged. The local arm merges
      # HEAD_SHA by construction; this arm must prove the branch still
      # points at the judged sha before it hands the merge over. The
      # local ref is the proof we always have; the PR's remote head is
      # the stronger one when gh answers.
      judged_head="$HEAD_SHA"
      # THE LOCAL HALF'S TEETH (momentum-906 / principles-4001 /
      # questions-21): the auto flow hands down the JUDGED SHA, so
      # asking "what does $HEAD_BRANCH point at" answers itself
      # forever — the guard could never fire. The worktree's CURRENT
      # head is the honest question: the reviewed tree moved.
      work_head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
      if [ -n "$work_head" ] && [ "$work_head" != "$judged_head" ]; then
        echo "merge: the reviewed tree moved ($judged_head -> $work_head) since the review — unreviewed bytes would ride the merge; re-run the review on the new head" >&2
        exit 1
      fi
      # and every ref that pointed at the judged sha, read again
      drifted=""
      for ref in $(git -C "$REPO" for-each-ref --points-at "$judged_head" --format='%(refname)' refs/heads refs/remotes 2>/dev/null); do
        now="$(git -C "$REPO" rev-parse "$ref" 2>/dev/null || true)"
        if [ -n "$now" ] && [ "$now" != "$judged_head" ]; then
          drifted="$drifted $ref($now)"
        fi
      done
      if [ -n "$drifted" ]; then
        echo "merge: the branch moved since the review ($judged_head ->$drifted) — unreviewed bytes would ride the merge; re-run the review on the new head" >&2
        exit 1
      fi
      if [ -n "${PR_NUM:-}" ] && command -v gh >/dev/null 2>&1; then
        remote_head="$(gh pr view "$PR_NUM" --json headRefOid --jq .headRefOid 2>/dev/null || true)"
        if [ -z "$remote_head" ]; then
          echo "merge: PR #$PR_NUM's head could not be read — the merge would land bytes no verdict judged; refusing" >&2
          exit 1
        fi
        if [ "$remote_head" != "$judged_head" ]; then
          echo "merge: PR #$PR_NUM is at $remote_head but the review judged $judged_head — unreviewed bytes would ride the merge; re-run the review" >&2
          exit 1
        fi
      fi
      # THE MERGE SEAT (momentum-901): the gate runs in the job's run
      # dir — which is not a git work tree, so `gh pr merge` could not
      # resolve the repository and every accept died at MERGE_CMD
      # failed while the verdict already said accept. Run the merge
      # command FROM THE REPO.
      (cd "$REPO" && sh -c "$MERGE_CMD") || { echo "merge: MERGE_CMD failed" >&2; exit 1; }
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
    outcome accept
    ;;
  reject)
    n=$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.blocked.length)' "$prog/data/review/verdict.json")
    echo "merge: REJECTED — $n proven finding(s); feedback/ names the responsible parties; verdict at data/review/verdict.json" >&2
    outcome reject
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
