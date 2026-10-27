#!/usr/bin/env bash
# run-drill.sh — the recursive review drill: five real-agent runs, one
# per fixture case, asserting each VERDICT (and, for c5, the feedback
# partition). OPT-IN (real tokens, ~4 lenses + a divider per run):
#   PR_DRILL=1 test/e2e/pr-review/run-drill.sh <repo-checkout> [cases...]
# Each case: materialize via `whl review`, levy --unattended, wait for
# the job to end, then judge the receipt. Exit 0 = every case behaved.
set -uo pipefail
repo_checkout="${1:?usage: run-drill.sh <repo-checkout> [cases...]}"
shift || true
cases="${*:-c1 c2 c3 c4 c5}"
root="${PR_DRILL_ROOT:-$HOME/.whl-pr-drill}"
whl="$repo_checkout/bin/whl"

bash "$(dirname "$0")/fixtures.sh" "$root"

DRILL_MODEL="${DRILL_MODEL:-glm-5.3-flash}" # this machine's opencode default; override per environment

fails=0
declare -a receipt=()

say() { printf '%s\n' "$*"; }

# wait until the named job is no longer running (battery pattern)
wait_job() {
  local jid="$1" i=0
  while [ $i -lt 240 ]; do
    local running
    running=$("$whl" jobs 2>/dev/null | awk -v j="$jid" '$1 == j && $2 == "running"' | head -1)
    [ -z "$running" ] && return 0
    i=$((i + 1)); sleep 20
  done
  return 1
}

verdict_of() { node -e 'try{const v=require(process.argv[1]+"/data/review/verdict.json");console.log(v.verdict)}catch{console.log("none")}' "$1"; }

run_case() {
  local name="$1" base="$2" head="$3" want="$4" trace_dir="${5:-}"
  local jobid
  jobid=$( "$whl" review "$root/$name" --base "$base" --head "$head" --out "$root/$name-prog" \
      --title "$name drill" ${DRILL_MODEL:+--model "$DRILL_MODEL"} ${trace_dir:+--trace-dir "$trace_dir"} --unattended 2>&1 | awk '/^job:/{print $2}' )
  if [ -z "$jobid" ]; then
    # no job levied — the only legal reason is the docs-only skip
    if [ "$want" = "skip" ]; then
      receipt+=("ok   $name — skipped at the door (docs-only), nothing levied")
      return 0
    fi
    receipt+=("FAIL $name — no job id printed (expected a levy)"); return 1
  fi
  wait_job "$jobid" || { receipt+=("FAIL $name — job never ended"); return 1; }
  # the program folder is STAGED: the verdict lives in the job's run dir
  local dir
  dir=$("$whl" jobs | awk -v j="$jobid" '$1 == j {print $NF}' | head -1)
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    receipt+=("FAIL $name — cannot resolve job dir for $jobid"); return 1
  fi
  local got; got=$(verdict_of "$dir")
  if [ "$got" != "$want" ]; then
    receipt+=("FAIL $name — verdict '$got', wanted '$want' (job $jobid, $dir)"); return 1
  fi
  receipt+=("ok   $name — verdict $got (job $jobid)")
  LAST_JOB_DIR="$dir"
  return 0
}

check_merge() {
  if git -C "$root/c1" log main --oneline -1 | grep -q "pr-review: accept"; then
    receipt+=("ok   c1 — merged (accept did the merge)")
  else
    receipt+=("FAIL c1 — accept but no merge commit on main"); fails=$((fails + 1))
  fi
}

check_split() {
  local dir="$LAST_JOB_DIR" alice bob
  alice=$(ls "$dir/feedback" 2>/dev/null | grep -c alice || true)
  bob=$(ls "$dir/feedback" 2>/dev/null | grep -c bob || true)
  if [ "$alice" = "1" ] && [ "$bob" = "1" ] && [ -f "$dir/feedback/MAP.md" ]; then
    # each author got ONLY their module's finding
    if grep -q "queue.ts" "$dir/feedback/alice.md" && ! grep -q "cache.ts" "$dir/feedback/alice.md" \
       && grep -q "cache.ts" "$dir/feedback/bob.md" && ! grep -q "queue.ts" "$dir/feedback/bob.md"; then
      receipt+=("ok   c5 — feedback split by responsibility (alice→queue, bob→cache)")
    else
      receipt+=("FAIL c5 — feedback files exist but the split is wrong"); fails=$((fails + 1))
    fi
  else
    receipt+=("FAIL c5 — expected feedback/alice.md + feedback/bob.md + MAP.md"); fails=$((fails + 1))
  fi
}

for c in $cases; do
  case "$c" in
    c1)
      # an ACCEPT consumes the fixture (the merge gate moves main, and
      # main..fix becomes empty) — rebuild it before every c1 run
      rm -rf "$root/c1"
      bash "$(dirname "$0")/fixtures.sh" "$root" >/dev/null
      if run_case c1 main fix accept; then check_merge; else fails=$((fails + 1)); fi ;;
    c2) run_case c2 main fast-stop reject || fails=$((fails + 1)) ;;
    c3) run_case c3 main discount reject || fails=$((fails + 1)) ;;
    c4) run_case c4 main docs skip || fails=$((fails + 1)) ;;
    c5) if run_case c5 main pair-fix reject "$root/c5-trace"; then check_split; else fails=$((fails + 1)); fi ;;
    *) say "unknown case $c"; exit 2 ;;
  esac
done

say "─ the drill receipt ─"
for line in "${receipt[@]}"; do say "$line"; done
say "fails: $fails"
[ "$fails" -eq 0 ] || exit 1
