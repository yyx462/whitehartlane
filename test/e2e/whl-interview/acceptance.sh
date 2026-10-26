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
work="$(mktemp -d "${TMPDIR:-/tmp}/whl-accept.XXXXXX")"
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
# --from rail:... books a PROCESS spawner: no conversation is woken,
# but the durable wake.json IS written — E6's repair hint lands there
AGENTIC_OS_RELAY_CAP=120 WHL run "$run_src" --from "rail:whl-acceptance" --unattended >"$work/run.out" 2>&1 &
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
# the run dir comes from the door's OWN log line — the jobs table wraps
# noisy rows (a task with newlines splits columns) and must never be
# parsed for paths; state comes from the job record on disk
rdir="$(dirname "$(grep -oE "log: .*orchestrator\.log" "$work/run.out" | head -1 | cut -d" " -f2-)")"
jobstate() { python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('state','?'))" "$(dirname "$rdir")/job.json" 2>/dev/null || echo "?"; }
state="$(jobstate)"
while [[ "$state" == "running" ]] && [ $SECONDS -lt $deadline ]; do
  sleep 15
  state="$(jobstate)"
done
echo "run: $jid state=$state dir=$rdir"
wait "$run_pid" 2>/dev/null || true

echo "== E2: ONE folder for the run, subfolders inside it =="
if [[ "$state" == "retired" ]]; then
  inside=$(ls "$rdir" 2>/dev/null | tr '\n' ' ')
  report_status=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('status','?'))" "$rdir/report.json" 2>/dev/null || echo "?")
  # THIS commission's jobs only: every job the door books records the
  # program source it admitted (job.spur.source); this run's staged
  # source lives under $work. A SHARED OS disk (other sessions,
  # diagnostics — run #12 counted two doctor probes) must not move the
  # count; same-source = same commission, and one commission = one job.
  jobs_new=$(python3 - "$work" <<'PY'
import json, os, sys
from pathlib import Path
work = Path(sys.argv[1]).resolve()
root = Path(os.environ.get("AGENTIC_OS_HOME", os.path.expanduser("~/.local/share/agentic-os"))) / "sessions"
count = 0
if root.is_dir():
    for jobFile in root.glob("*/jobs/*/job.json"):
        try:
            src = json.loads(jobFile.read_text()).get("spur", {}).get("source", "")
        except Exception:
            continue
        if src and Path(src).resolve().is_relative_to(work):
            count += 1
print(count)
PY
)
  if [ "$jobs_new" -eq 1 ] && [ "$report_status" = "done" ] && [ -d "$rdir/messages" ] && [ -d "$rdir/data" ] && [ -d "$rdir/deliverables" ] && [ -s "$rdir/deliverables/interview.md" ]; then
    check "E2" ok "ONE job for this commission ($jid), report done, both shelves inside (data/ works, deliverables/ reads), QA lecture rendered"
  else
    check "E2" fail "state=$state report=$report_status jobs_this_commission=$jobs_new inside: ${inside:-none}"
  fi
else
  check "E2" fail "run state=$state (expected a finished green run)"
fi

echo "== E3: send tool — own mailbox only, peers ro, rail ledger =="
trace="$(WHL events --job "$jid" 2>/dev/null || true)"
e3="$(python3 - "$rdir" <<'PY'
import json, os, sys
from pathlib import Path
rdir = Path(sys.argv[1])
msgs = sorted(rdir.glob("messages/*/*.json"))
own = [f for f in msgs if json.loads(f.read_text()).get("from") == f.parent.name]
cross = [f for f in msgs if json.loads(f.read_text()).get("from") != f.parent.name]
# the SCOPE law: a member's sandbox config grants its OWN outbox and
# the data/ shelf, never a peer's outbox
scopes = {}
for cfg in sorted(rdir.glob("sandboxes/*/opencode.json")):
    member = cfg.parent.name
    ext = " ".join(json.loads(cfg.read_text()).get("permission", {}).get("external_directory", {}).keys())
    scopes[member] = ext
leak = [m for m, ext in scopes.items() if any(f"/messages/{p}" in ext for p in scopes if p != m)]
tool = (rdir / "tools" / "send.mjs").is_file()
protocol = all("send.mjs" in (rdir / "briefs" / f"{m}.md").read_text() for m in scopes) if scopes else False
print(f"own={len(own) - len(cross)}/{len(msgs)} cross={len(cross)} scope_leak={len(leak)} tool={tool} protocol={protocol}")
PY
)"
own_n="$(echo "$e3" | grep -oE 'own=[0-9]+/[0-9]+' | cut -d= -f2)"
cross_n="$(echo "$e3" | grep -oE 'cross=[0-9]+' | cut -d= -f2)"
leak_n="$(echo "$e3" | grep -oE 'scope_leak=[0-9]+' | cut -d= -f2)"
tool_ok="$(echo "$e3" | grep -oE 'tool=(True|False)' | cut -d= -f2)"
proto_ok="$(echo "$e3" | grep -oE 'protocol=(True|False)' | cut -d= -f2)"
ledger_n="$(echo "$trace" | grep -cE 'mail\.filed|mail\.delivered|\brelay\b' || true)"
if [ "${cross_n:-1}" = "0" ] && [ "${leak_n:-1}" = "0" ] && [ "${tool_ok}" = "True" ] && [ "${proto_ok}" = "True" ] && [ "${ledger_n:-0}" -gt 0 ]; then
  check "E3" ok "send tool staged + taught, own mailbox only ($own_n), no peer outbox in any scope, rail ledger $ledger_n rows"
elif [ "${cross_n:-1}" != "0" ]; then
  check "E3" fail "$e3 (cross-writes)"
else
  check "E3" pend "$e3 ledger=$ledger_n — slice 5 pieces still landing"
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
WHL fail "$jid" --reason "e6-acceptance" --again >"$work/fail.out" 2>&1
hint="$(grep -c 're-runs the verdict' "$rdir/wake.json" 2>/dev/null || true)"
hint2="$(WHL events --job "$jid" 2>/dev/null | grep -c 're-runs the verdict' || true)"
if [ "${hint:-0}" -gt 0 ] || [ "${hint2:-0}" -gt 0 ]; then
  check "E6" ok "the wake SAYS the cheapest repair: program changed since booking — whl continue re-runs the verdict"
else
  check "E6" fail "no repair hint on the wake/trace; fail.out: $(tail -2 "$work/fail.out" | tr '\n' ' ')"
fi

echo "== E7: the question bank — <=5 asked, banked, updated from this run =="
e7="$(python3 - "$rdir" "$here" <<'PY'
import json, sys, tomllib
from pathlib import Path
rdir, here = (Path(p) for p in sys.argv[1:3])
bank_path = rdir / "data" / "questions.toml"
if not bank_path.exists():
    bank_path = rdir / "questions.toml"
bank_run = tomllib.loads(bank_path.read_text()).get("question", [])
bank_repo = tomllib.loads((here / "questions.toml").read_text()).get("question", [])
repo_qs = {q["q"] for q in bank_repo}
appends = [q["q"] for q in bank_run if q["q"] not in repo_qs]
def norm(x):
    return " ".join(x.casefold().replace("'", "").replace('"', "").replace("?", "").replace(".", "").split())
run_qs = {norm(q["q"]) for q in bank_run if not q.get("retired")}
fresh = []
tr = rdir / "data" / "transcript.jsonl"
if tr.exists():
    doc = json.loads(tr.read_text())
    for m in doc.get("messages", []):
        c = m.get("contract") or {}
        if c.get("topic") and c["topic"] != "rebuttal" and c.get("question"):
            fresh.append(c["question"])
print(f"transcript={'ok' if tr.exists() else 'missing'}")
asked_ok = all(norm(q) in run_qs for q in fresh)
print(f"fresh={len(fresh)} within_cap={len(fresh) <= 5} appends={len(appends)} all_banked={asked_ok}")
PY
)"
transcript="$(echo "$e7" | grep -oE 'transcript=(ok|missing)' | cut -d= -f2)"
if [ "$transcript" != "ok" ]; then
  check "E7" fail "no data/transcript.jsonl — the audit went RED and built nothing (the exchange itself failed the contract)"
elif echo "$e7" | grep -qE 'fresh=[1-5] within_cap=True appends=[0-9]+ all_banked=True'; then
  check "E7" ok "$e7 (bank updated from this run where needed)"
else
  check "E7" fail "$e7 (fresh must be 1..5 — zero means the transcript parse found no questions)"
fi

echo
echo "scoreboard: $fails failing"
[ "$fails" -eq 0 ] || exit 1
