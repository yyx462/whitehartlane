#!/usr/bin/env bash
# acceptance.sh — THE 7-expectation acceptance test of the whl-interview
# commission, in the user's verbatim order. One LIVE interview run sits
# at the center; every expectation is checked against that run's own
# artifacts (receipts, not prose):
#
#   E1 the old spur (no contract.toml) is refused by screening, no job
#   E2 ONE folder for the run, subfolders (stations) inside it
#   E3 members send via the tool: own mailbox rw, peers ro, rail ledger
#   E4 prompts + audits generated from the ONE contract
#   E5 token / trace / time-cost / tables semantic logging
#   E6 on failure the rail computes the CHEAPEST repair and says it
#   E7 the question bank: interviewer updates it from this run, <=5 asked
#
# Expectations whose mechanism has not landed yet print `pend` (named,
# with the queue item that delivers them) — never a silent pass. Any
# `fail` exits 1. Usage: bash test/e2e/whl-interview/acceptance.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
WHL() { node --experimental-strip-types "$repo/bin/whitehartlane" "$@"; }
work="$(mktemp -d "${TMPDIR:-/tmp}/whl-accept-")"
trap 'rm -rf "$work"' EXIT
fails=0

check() { # <id> <ok|fail|pend> <receipt>
  case "$2" in
    ok)   echo "ok   $1 — $3" ;;
    fail) echo "FAIL $1 — $3"; fails=$((fails + 1)) ;;
    pend) echo "pend $1 — $3" ;;
  esac
}

jobcount() { WHL jobs 2>/dev/null | grep -c '^j-' || true; }

echo "== E1: the old spur (no contract.toml) is refused, no job formed =="
e1="$work/old-spur"; cp -R "$here" "$e1"; rm "$e1/contract.toml"
before=$(jobcount)
e1out="$(WHL run "$e1" --unattended 2>&1)"; e1rc=$?
after=$(jobcount)
if [ "$e1rc" -ne 0 ] && [[ "$e1out" == *"no deliverable forced in contract.toml"* ]] && [ "$after" -eq "$before" ]; then
  check "E1" ok "refused at rc=$e1rc, jobs $before == $after"
else
  check "E1" fail "rc=$e1rc jobs $before->$after out: ${e1out%%$'\n'*}"
fi

echo "== the LIVE interview run (one job, real workers) =="
run_src="$work/run"; cp -R "$here" "$run_src"
AGENTIC_OS_RELAY_CAP=120 WHL run "$run_src" --unattended >"$work/run.out" 2>&1 &
run_pid=$!
jid="$(grep -oE '^job: j-[a-z0-9]+' "$work/run.out" | head -1 | cut -d' ' -f2)"
deadline=$((SECONDS + 2400))
while [ -z "$jid" ] && [ $SECONDS -lt $deadline ]; do
  sleep 2
  jid="$(grep -oE '^job: j-[a-z0-9]+' "$work/run.out" 2>/dev/null | head -1 | cut -d' ' -f2)"
done
if [ -z "$jid" ]; then
  echo "FATAL — the door never booked the run:"; tail -5 "$work/run.out"; exit 1
fi
state="$(WHL jobs | awk -v j="$jid" '$1==j{print $2}')"
while [[ "$state" == "running" ]] && [ $SECONDS -lt $deadline ]; do
  sleep 15
  state="$(WHL jobs | awk -v j="$jid" '$1==j{print $2}')"
done
rdir="$(WHL jobs | awk -v j="$jid" '{print $NF}')"
echo "run: $jid state=$state dir=$rdir"
wait "$run_pid" 2>/dev/null || true

echo "== E2: ONE folder for the run, subfolders inside it =="
if [[ "$state" == "ok" ]] || [[ "$state" == "retired" ]] || [[ "$state" == "green" ]]; then
  inside=$(ls "$rdir" 2>/dev/null | tr '\n' ' ')
  jobs_for_src=$(WHL jobs | awk -v d="$rdir" '$NF==d' | wc -l | tr -d ' ')
  if [ "$jobs_for_src" -eq 1 ] && [ -d "$rdir/messages" ] && [ -d "$rdir/data" ]; then
    check "E2" ok "one job dir, stations inside: ${inside:-empty}"
  else
    check "E2" fail "jobs_for_src=$jobs_for_src inside: ${inside:-none}"
  fi
else
  check "E2" fail "run state=$state (expected a finished green run)"
fi

echo "== E3: send tool — own mailbox only, peers ro, rail ledger =="
trace="$(WHL events --job "$jid" 2>/dev/null || true)"
e3="$(python3 - "$rdir" <<'PY'
import json, sys
from pathlib import Path
rdir = Path(sys.argv[1])
msgs = sorted(rdir.glob("messages/*/*.json"))
own = [f for f in msgs if json.loads(f.read_text()).get("from") == f.parent.name]
cross = [f for f in msgs if json.loads(f.read_text()).get("from") != f.parent.name]
print(f"own={len(own) - len(cross)}/{len(msgs)} cross={len(cross)}")
PY
)"
own_n="$(echo "$e3" | grep -oE 'own=[0-9]+/[0-9]+' | cut -d= -f2)"
cross_n="$(echo "$e3" | grep -oE 'cross=[0-9]+' | cut -d= -f2)"
ledger_n="$(echo "$trace" | grep -cE 'mail\.|message\.|relay\.' || true)"
if [ "${cross_n:-1}" = "0" ] && [ "${own_n:-0}" != "0/0" ]; then
  if [ "${ledger_n:-0}" -gt 0 ]; then
    check "E3" ok "every message from its own mailbox ($own_n), rail ledger $ledger_n trace rows"
  else
    check "E3" pend "own-mailbox holds ($own_n, 0 cross-writes); the rail ledger + send TOOL land with #200 slice 5 (send tool)"
  fi
else
  check "E3" fail "$e3"
fi

echo "== E4: prompts + audits generated from the ONE contract =="
if (cd "$here" && python3 hooks/render_contract.py --check >/dev/null 2>&1) && grep -q 'contract.toml' "$here/hooks/audit.py"; then
  check "E4" ok "brief law sections fresh (drift-cop 0) and audit.py reads the same contract.toml"
else
  check "E4" fail "stale brief section or audit detached from the contract"
fi

echo "== E5: token / trace / time-cost / tables semantic logging =="
e5rows="$(echo "$trace" | grep -cE 'turn\.tokens|usage|tokens' || true)"
if [ "${e5rows:-0}" -gt 0 ]; then
  check "E5" ok "$e5rows token rows on the trace"
else
  check "E5" pend "trace rows exist but no token rows yet — queue item 3 (host usageOf + turn.tokens events) delivers this"
fi

echo "== E6: failure -> the rail says the CHEAPEST repair out loud =="
printf '\n# e6-acceptance: program touched after booking (hash moves)\n' | tee -a "$run_src/contract.toml" >>"$rdir/contract.toml"
WHL fail "$jid" --reason "e6-acceptance" >"$work/fail.out" 2>&1
hint="$(WHL events --job "$jid" 2>/dev/null | grep -c 're-runs the verdict' || true)"
if [ "${hint:-0}" -gt 0 ]; then
  check "E6" ok "wake names the cheapest repair: whl continue re-runs the verdict (on the trace)"
else
  check "E6" fail "no repair hint on the wake/trace; fail.out: $(tail -2 "$work/fail.out" | tr '\n' ' ')"
fi

echo "== E7: the question bank — <=5 asked, banked, updated from this run =="
e7="$(python3 - "$rdir" "$here" <<'PY'
import json, sys, tomllib
from pathlib import Path
rdir, here = (Path(p) for p in sys.argv[1:3])
bank_run = tomllib.loads((rdir / "questions.toml").read_text()).get("question", [])
bank_repo = tomllib.loads((here / "questions.toml").read_text()).get("question", [])
repo_qs = {q["q"] for q in bank_repo}
appends = [q["q"] for q in bank_run if q["q"] not in repo_qs]
run_qs = {q["q"] for q in bank_run if not q.get("retired")}
fresh = []
tr = rdir / "data" / "transcript.jsonl"
if tr.exists():
    doc = json.loads(tr.read_text())
    for m in doc.get("messages", []):
        c = m.get("contract") or {}
        if c.get("topic") and c["topic"] != "rebuttal" and c.get("question"):
            fresh.append(c["question"])
asked_ok = all(q in run_qs for q in fresh)
print(f"fresh={len(fresh)} within_cap={len(fresh) <= 5} appends={len(appends)} all_banked={asked_ok}")
PY
)"
if echo "$e7" | grep -qE 'fresh=[0-5] within_cap=True appends=[0-9]+ all_banked=True'; then
  check "E7" ok "$e7 (bank updated from this run where needed)"
else
  check "E7" fail "$e7"
fi

echo
echo "scoreboard: $fails failing"
[ "$fails" -eq 0 ] || exit 1
