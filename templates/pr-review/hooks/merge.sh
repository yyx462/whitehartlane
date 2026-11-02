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
outcome() { # $1 = accept|reject|refused
  local payload
  payload="{\"outcome\":\"$1\",\"head\":\"${HEAD_SHA:-}\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  # the run's own copy (the job's run dir — the rail's record)
  printf '%s\n' "$payload" >>"$prog/data/review/merge.json" 2>/dev/null || true
  # and the STAGED program's seat (where the watcher waits)
  local seat="${STAGED_DIR:-$prog}/data/review/merge.json"
  mkdir -p "$(dirname "$seat")" 2>/dev/null || true
  printf '%s\n' "$payload" >"$seat" 2>/dev/null || true
}

# EVERY exit writes the seat (momentum-909 / tests-10201): the nine
# refusal paths left the watcher's seat empty and the PR heard
# "unknown" — the commission's end is a FACT, whatever the end was.
# The trap lives in the MAIN shell now: the verdict read is a command
# substitution (no pipeline subshell — a pipeline's right side is a
# subshell whose trap could never cover the exits BEFORE it, and the
# unreadable-verdict exit happens FIRST), the case sets the outcome,
# and the one EXIT trap sees every arm's value.
verdict="$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.verdict)' "$prog/data/review/verdict.json" 2>/dev/null || true)"
MERGE_OUTCOME=refused
trap 'outcome "$MERGE_OUTCOME"' EXIT
case "$verdict" in
  accept)
    # SHARED ACCEPT FACT (momentum-3001): the judged head is the
    # review's pinned sha — BOTH arms merge onto it, so the chain and
    # P0 proofs below guard both, not just the MERGE_CMD arm.
    judged_head="$HEAD_SHA"
    # THE CHAIN CHECK (the owner's convergence ruling, 2026-11-02;
    # hoisted to BOTH arms by momentum-3001): delta rounds judge only
    # the commits since the last judged head; this sweep proves the
    # TILING — folding the judged spans forward from BASE_SHA, the
    # frontier must reach the judged head. Overlap is re-reading
    # (sound); a GAP is bytes no verdict ever judged — refuse.
    if [ -n "${JUDGED_SPANS:-}" ]; then
      span_frontier="$BASE_SHA"
      span_progress=1
      while [ "$span_progress" = "1" ]; do
        span_progress=0
        for span_pair in $JUDGED_SPANS; do
          span_f="${span_pair%%:*}"; span_h="${span_pair##*:}"
          # starts at or before the frontier…
          if [ "$span_f" != "$span_frontier" ] && ! git -C "$REPO" merge-base --is-ancestor "$span_f" "$span_frontier" 2>/dev/null; then continue; fi
          # …and reaches STRICTLY past it, forward only (momentum-3100
          # / questions-6, r23): the head must DESCEND from the
          # frontier — "not an ancestor of it" is also true of a SIDE
          # commit, and the fold could step backward onto an earlier
          # round's head; and a head EQUAL to the frontier is a no-op
          # advance that re-arms progress forever — the fold spins and
          # the accept hangs (the r23 receipt: every tiling merge
          # timed out).
          if [ "$span_h" = "$span_frontier" ] || ! git -C "$REPO" merge-base --is-ancestor "$span_frontier" "$span_h" 2>/dev/null; then continue; fi
          span_frontier="$span_h"; span_progress=1
        done
      done
      if [ "$span_frontier" != "$judged_head" ] && ! git -C "$REPO" merge-base --is-ancestor "$judged_head" "$span_frontier" 2>/dev/null; then
        echo "merge: the judged spans leave a GAP — the frontier folds forward only to ${span_frontier:-(nothing)} but the review judged $judged_head; bytes no verdict judged would ride the merge; re-review the gap" >&2
        exit 1
      fi
    fi
    # THE UNANSWERED-P0 CHECK (momentum-3002, 2026-11-02; window +
    # pathspec corrected r23): the chain proves READS; this proves
    # ANSWERS. Three laws: (1) a P0's era is its FLAGGING round's head
    # — history index i pairs with judged span i (both oldest-first;
    # the spans carry one extra, the current round) — NOT this
    # verdict's reading start, or a fix that landed before the accept
    # sits outside the delta window and every later round refuses
    # (momentum-3102); (2) bucket keys are BASENAMES (the stop rule's
    # cluster keys) and git pathspecs are repo-root-relative, so a
    # basename is resolved against the files this PR touched before
    # asking git anything (principles-3001 / questions-1 /
    # tests-10508 — every subdirectory finding read as 'unchanged');
    # (3) unchanged since its flagging round = unanswered — fix it or
    # overrule (overruled = the owner's override door, which does not
    # pass through this arm).
    if [ -n "${STOP_HISTORY:-}" ]; then
      p0_from_default="$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.judgedFrom || process.env.BASE_SHA || "")' "$prog/data/review/verdict.json" 2>/dev/null || true)"
      p0_pairs="$(node -e '
        const hist = JSON.parse(process.argv[1])
        const spans = (process.argv[2] || "").split(" ").filter(Boolean).map(p => p.split(":"))
        const judged = process.argv[3] || ""
        const out = []
        hist.forEach((r, i) => {
          if (!r.p0) return
          const sp = spans[i]
          // the flagging head is the head of the round that flagged
          // it; a history index whose span IS the current round (a
          // hand-down of priors without their own spans, the
          // tests-10508 shape) falls to that span START — the era
          // still opens before the flag.
          let head = ""
          if (sp) head = sp[1] === judged ? sp[0] : sp[1]
          for (const b of r.buckets) out.push(i + " " + b.split(":")[0] + " " + head)
        })
        console.log(out.join("\n"))' "$STOP_HISTORY" "${JUDGED_SPANS:-}" "$judged_head" 2>/dev/null || true)"
      while read -r p0_round p0_base p0_head; do
        [ -n "$p0_base" ] || continue
        p0_esc="$(printf '%s' "$p0_base" | sed 's/[.[\*^$()+?{|]/\\&/g')"
        p0_file="$(git -C "$REPO" diff --name-only "$BASE_SHA" "$judged_head" 2>/dev/null | grep -E "(^|/)$p0_esc$" | head -1 || true)"
        p0_head="${p0_head:-$p0_from_default}"
        [ -n "$p0_file" ] && [ -n "$p0_head" ] || continue
        if ! git -C "$REPO" diff --quiet "$p0_head" "$judged_head" -- "$p0_file" 2>/dev/null; then continue; fi
        echo "merge: an UNANSWERED P0 rides the merge — $p0_file was P0-flagged by round $((p0_round + 1)) and its bytes are unchanged since ${p0_head:0:12}; fix it or overrule" >&2
        exit 1
      done <<EOF
$p0_pairs
EOF
    fi
    if [ -n "${MERGE_CMD:-}" ]; then
      # THE HEAD-DRIFT GUARD (momentum-902, the base twin): the
      # MERGE_CMD arm merges the PR's CURRENT head — a push during the
      # review would land bytes no verdict judged. The local arm merges
      # HEAD_SHA by construction; this arm must prove the branch still
      # points at the judged sha before it hands the merge over. The
      # local ref is the proof we always have; the PR's remote head is
      # the stronger one when gh answers.
      # NO WITNESS, NO MERGE (tests-10301 / tests-20002): a HEAD_BRANCH
      # that is empty — or a legacy config holding the judged SHA
      # itself, which answers its own question forever — means the
      # door could not name the reviewed branch; the local arm cannot
      # verify, so the PR's remote head becomes the ONLY witness, and
      # without a PR number the accept refuses rather than merge a
      # branch nobody can prove still holds the judged bytes.
      if { [ -z "${HEAD_BRANCH:-}" ] || printf '%s' "${HEAD_BRANCH:-}" | grep -qE '^[0-9a-f]{7,40}$'; } && [ -z "${PR_NUM:-}" ]; then
        echo "merge: the reviewed branch cannot be named (no HEAD_BRANCH) and no PR number exists to verify the remote head — unreviewed bytes would ride the merge; re-run the review naming the branch" >&2
        exit 1
      fi
      # THE BRANCH HALF (questions-2 / tests-1): HEAD_BRANCH is the
      # branch NAME (the door derives it from the judged sha ✓) — ask
      # where it points NOW. The earlier ref-sweep arm was vacuous:
      # `for-each-ref --points-at` lists only refs that STILL point at
      # the judged sha, so it could never observe a move.
      branch_head=""
      if [ -n "${HEAD_BRANCH:-}" ] && [ "$HEAD_BRANCH" != "$judged_head" ]; then
        # --verify: a plain rev-parse ECHOES the unresolved arg to
        # stdout while erroring on stderr — `2>/dev/null || true` kept
        # the echo, and a branch name compared like a sha refused an
        # honest merge. --verify prints nothing on failure.
        branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" 2>/dev/null || true)"
        # UNREADABLE IS DRIFT (momentum-2002 / tests-20001): a named
        # branch that cannot be read was deleted, renamed or pruned
        # between the review and the merge — skipping the comparison
        # here handed MERGE_CMD a merge with NO local witness at all.
        if [ -z "$branch_head" ]; then
          echo "merge: $HEAD_BRANCH cannot be read (deleted? renamed? pruned?) since the review — the reviewed branch no longer exists locally; re-run the review on the new head" >&2
          exit 1
        fi
        if [ "$branch_head" != "$judged_head" ]; then
          echo "merge: $HEAD_BRANCH moved ($judged_head -> $branch_head) since the review — unreviewed bytes would ride the merge; re-run the review on the new head" >&2
          exit 1
        fi
      fi
      # NOT the user's checkout (principles-105 / questions-29): the
      # reviewed tree is the judged sha on its BRANCH — the operator's
      # working copy is routinely parked on the trunk while the PR's
      # bytes sit on the feature branch, and a guard that compares the
      # checkout's HEAD refuses an accept whose bytes the verdict did
      # judge. The branch tip above and the PR's remote head below are
      # the two honest witnesses; the checkout is neither.
      # and every ref that EVER pointed at the judged sha (questions-2:
      # --points-at lists only refs that STILL point there, so the old
      # sweep could never observe a move — a branch that moved after
      # the review sailed through unnamed). The reflog is the only
      # local witness of "used to": a ref whose log carries the judged
      # sha and whose tip no longer does has moved.
      drifted=""
      for ref in $(git -C "$REPO" for-each-ref --format='%(refname)' refs/heads refs/remotes 2>/dev/null); do
        now="$(git -C "$REPO" rev-parse "$ref^{commit}" 2>/dev/null || true)"
        [ -z "$now" ] && continue
        [ "$now" = "$judged_head" ] && continue
        # NO -q (the questions-39 receipt): grep -q exits on the first
        # match, git then dies of SIGPIPE, and under this script's
        # pipefail the pipeline reads as FAILED exactly when it
        # matched. Full-read grep, status 0 on a real match.
        if git -C "$REPO" reflog show "$ref" --format=%H 2>/dev/null | grep -F "$judged_head" >/dev/null; then
          drifted="$drifted $ref($now)"
        fi
      done
      if [ -n "$drifted" ]; then
        echo "merge: the branch moved since the review ($judged_head ->$drifted) — unreviewed bytes would ride the merge; re-run the review on the new head" >&2
        exit 1
      fi
      # NO WITNESS, NO MERGE — gh INCLUDED (tests-2): with no nameable
      # branch ($branch_head empty) the PR's remote head is the ONLY
      # witness; the old gate skipped the whole block when gh was
      # absent and merged witnessless — the exact law this file states.
      if [ -n "${PR_NUM:-}" ] && [ -z "$branch_head" ] && ! command -v gh >/dev/null 2>&1; then
        echo "merge: no nameable branch and no gh to read PR #$PR_NUM's head — NO WITNESS, NO MERGE; refusing" >&2
        exit 1
      fi
      if [ -n "${PR_NUM:-}" ] && command -v gh >/dev/null 2>&1; then
        # THE P0 WRAP (principles-1, r21): the probe ran from the gate's
        # own run dir — not a git work tree — so live gh could not
        # resolve a repository and every accept with a PR number
        # refused while asserting the PR carried unreviewed bytes
        # (fixture stubs ignored cwd, which is why no test ever saw
        # it). gh answers from the REPO, or the witness is empty.
        remote_head="$( { cd "$REPO" && gh pr view "$PR_NUM" --json headRefOid --jq .headRefOid; } 2>/dev/null || true )"
        if [ -z "$remote_head" ]; then
          echo "merge: PR #$PR_NUM's head could not be read — the merge would land bytes no verdict judged; refusing" >&2
          exit 1
        fi
        if [ "$remote_head" != "$judged_head" ]; then
          echo "merge: PR #$PR_NUM is at $remote_head but the review judged $judged_head — unreviewed bytes would ride the merge; re-run the review" >&2
          exit 1
        fi
      fi
      # THE BASE'S HALF (principles-108): the local arm below has
      # guarded base drift since r8b; the MERGE_CMD arm checked the
      # HEAD four times and the BASE never — yet this arm merges the
      # PR onto its base, so a base that moved during the review lands
      # unreviewed commits inside the accepted merge. A base we cannot
      # NAME (BASE_BRANCH empty or sha-like, questions-30) cannot be
      # verified at all — refuse rather than merge blind.
      if [ -z "${BASE_BRANCH:-}" ] || printf '%s' "$BASE_BRANCH" | grep -qE '^[0-9a-f]{7,40}$'; then
        echo "merge: the base cannot be named (BASE_BRANCH='${BASE_BRANCH:-}') — its drift cannot be verified; refusing (re-run the review naming the base branch)" >&2
        exit 1
      fi
      now_base="$(git -C "$REPO" rev-parse --verify "$BASE_BRANCH^{commit}" 2>/dev/null || true)"
      if [ -z "$now_base" ]; then
        echo "merge: base $BASE_BRANCH could not be read — its drift cannot be verified; refusing" >&2
        exit 1
      fi
      if [ "$now_base" != "$BASE_SHA" ]; then
        echo "merge: base $BASE_BRANCH moved ($BASE_SHA -> $now_base) since the review — re-run the review on the new base" >&2
        exit 1
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
      now_base="$(git -C "$REPO" rev-parse --verify "$BASE_BRANCH^{commit}" 2>/dev/null || true)"
      if [ -z "$now_base" ]; then
        echo "merge: base $BASE_BRANCH could not be read — its drift cannot be verified; refusing" >&2
        exit 1
      fi
      if [ "$now_base" != "$BASE_SHA" ]; then
        echo "merge: base $BASE_BRANCH moved ($BASE_SHA -> $now_base) since the review — re-run the review on the new base" >&2
        exit 1
      fi
      git -C "$REPO" checkout -q "$BASE_BRANCH" || { echo "merge: cannot checkout $BASE_BRANCH" >&2; exit 1; }
      git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept $TITLE" "$HEAD_SHA" \
        || { echo "merge: git merge failed (conflicts? base moved?)" >&2; exit 1; }
    fi
    echo "merge: accepted — $TITLE ($HEAD_SHA) merged"
    MERGE_OUTCOME=accept
    ;;
  reject)
    n=$(node -e 'const v=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); console.log(v.blocked.length)' "$prog/data/review/verdict.json")
    echo "merge: REJECTED — $n proven finding(s); feedback/ names the responsible parties; verdict at data/review/verdict.json" >&2
    MERGE_OUTCOME=reject
    # the fixer's exit (the 2026-10-30 ruling): the reviewer reminds, the
    # owner decides. Fix what you accept; after round 1 you may REJECT
    # THE REJECTION — every blocked finding answered with a one-line why,
    # merged under a recorded override, never stealth
    echo "merge: the fixer's exit — fix + adopt the repros, or (after round 1) overrule: whl ship <repo> --pr <n> --overrule <file.json> (every blocked finding answered, receipt on the PR)" >&2
    # THE STOP RULE'S BANNER (2026-11-01): when the owner's measured
    # criterion holds (novel root causes within bounds for K rounds,
    # nothing stuck, no P0), the gate SAYS SO — the loop's honest end
    # is announced where the fixer reads, not left to owner folklore.
    # Silence is the ordinary state (not-eligible is not news); the
    # twin writes its record at data/review/stop.json either way.
    if [ -f "$prog/hooks/stop-rule.mjs" ] && [ -n "${STOP_HISTORY:-}" ]; then
      stop_banner="$(node "$prog/hooks/stop-rule.mjs" "$prog/data/review/verdict.json" "$STOP_HISTORY" "${STOP_CFG:-}" 2>/dev/null || true)"
      if [ -n "$stop_banner" ]; then
        echo "$stop_banner" >&2
      fi
    fi
    # THE REFLECTION ASK (the owner's ruling, 2026-11-02): a loop that
    # keeps rejecting has a MECHANISM problem more often than a code
    # problem. CADENCE (the owner's numbers, 2026-11-02): silent
    # through round 4 — good faith first, findings get fixed; from
    # round 5 it asks every THIRD round (5, 8, 11…) — asking every
    # round would put a mechanism change in every push, which is its
    # own overfitting; never when eligible (the banner owns that
    # round). The answer must change the MECHANISM (a law appended to
    # AGENTS.md, a lens-brief edit, a gate change), not just fix
    # findings: the next round's lenses read the repo's own direction
    # docs, so an appended law is READ BACK by the reviewers
    # themselves.
    if [ -f "$prog/data/review/stop.json" ]; then
      reflect="$(node -e 'const s=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.exit(s.rounds>=5 && (s.rounds-5)%3===0 && !s.eligible ? 0 : 1)' "$prog/data/review/stop.json" 2>/dev/null && echo ask || true)"
      if [ -n "$reflect" ]; then
        echo "merge: THE REFLECTION ASK — round \$(node -e 'process.stdout.write(String(JSON.parse(require(\"node:fs\").readFileSync(process.argv[1],\"utf8\")).rounds))' "$prog/data/review/stop.json") and the stop criterion still does not hold (asked per the cadence: from round 5, every third round; see data/review/stop.json): WHY is this loop not converging? Answer by changing the MECHANISM — append a law to AGENTS.md, edit the lens briefs, or fix the gate. A finding-fix alone does not answer it." >&2
      fi
    fi
    exit 1
    ;;
  *)
    echo "merge: verdict.json says '$verdict' — refuse, never guess" >&2
    exit 1
    ;;
esac
