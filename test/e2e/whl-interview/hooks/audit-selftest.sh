#!/usr/bin/env bash
# audit-selftest.sh — prove the audit gate CHECKS rather than vibes:
# the golden mock exchange must PASS (one JSON counts line on stdout —
# the rail parses counts stdout strictly), and each doctored copy must
# FAIL for exactly the reason the gate exists. No whl, no panes, no
# tokens.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass_n=0
fail_n=0

run_audit() { # <dir> — stdout: JSON counts only; stderr: verdicts
  WHL_AUDIT_DIR="$1" python3 "$here/audit.py" "$1" 2>/dev/null
}

expect_pass() { # <dir> <label>
  local out
  if out=$(run_audit "$1") && echo "$out" | tail -1 | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
    pass_n=$((pass_n + 1)); echo "ok   — $2 (counts JSON: $(echo "$out" | tail -1))"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected PASS + JSON counts)"; WHL_AUDIT_DIR="$1" python3 "$here/audit.py" "$1" >&2
  fi
}

expect_fail() { # <dir> <label> <why-substring>
  local out
  if out=$(WHL_AUDIT_DIR="$1" python3 "$here/audit.py" "$1" 2>&1); then
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected rejection, got PASS)"
  elif [[ "$out" == *"$3"* ]]; then
    pass_n=$((pass_n + 1)); echo "ok   — $2 (bites: $3)"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (bit for the wrong reason: $out)"
  fi
}

python3 "$here/fixtures/gen_golden.py" "$work/golden" >/dev/null
expect_pass "$work/golden" "golden exchange passes with JSON counts"
[ -s "$work/golden/data/transcript.jsonl" ] || { echo "FAIL — transcript.jsonl not built"; exit 1; }
[ -s "$work/golden/interviews/$(date +%F)/gaps.md" ] || { echo "FAIL — interviews/<date>/ not delivered"; exit 1; }
pass_n=$((pass_n + 1)); echo "ok   — transcript built, artifacts delivered to interviews/<date>/"

m() { # <label> <why> <python-mutation>
  local d="$work/$1"
  cp -R "$work/golden" "$d"
  WHL_DIR="$d" python3 - "$d" <<PYEOF
import json
import sys
from pathlib import Path
d = Path("$d")
$3
PYEOF
  expect_fail "$d" "$1" "$2"
}

# 1. no gap sections at all = the interviewer was too soft (the brief's own law)
m zero-gaps "no gap stands" '
for f in sorted((d / "messages").glob("*interviewer.json")):
    body = json.loads(f.read_text())["body"]
    if "gap" in body and "races" in body:
        f.unlink()
g = d / "data/gaps.md"
g.write_text("# Gaps\n\nNone found — everything checked out.\n")
'

# 2. three consecutive malformed contracts — the one-re-ask law caps it
m malformed-run "malformed 3 times in a row" '
files = sorted((d / "messages").glob("*interviewer.json"))[:3]
for f in files:
    f.write_text(json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                             "body": "question without a contract block"}))
'

# 3. a topic past the 6-turn cap
m turn-cap "took 7 turns" '
files = sorted((d / "messages").glob("*.json"))
seq = int(files[-1].name.split("-")[0])
for n in range(5):
    c = {"topic": "admission-jev", "level": 4, "question": f"Break it again {n}?",
         "grade": "partial", "cited": True, "citation_checked": "ok",
         "move": "deeper", "gap_note": ""}
    s = seq + 1 + n
    (d / "messages" / f"{s:03d}-interviewer.json").write_text(
        json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                    "body": f"prose.\n\n```turn-contract\n{json.dumps(c)}\n```"}))
'

# 4. no standing gap after rebuttal = nothing survives = too soft
m no-stands "no gap stands" '
g = d / "data/gaps.md"
g.write_text(g.read_text().replace("rebuttal: stands", "rebuttal: refuted — src/engines/coworker.ts:161"))
'

# 5. topics opened out of the declared order
m topic-order "topics must open in declared order" '
first = sorted((d / "messages").glob("*interviewer.json"))[0]
txt = json.loads(first.read_text())
txt["body"] = txt["body"].replace("\"topic\": \"admission-jev\"", "\"topic\": \"spur-grammar\"")
first.write_text(json.dumps(txt))
'

# 6. a topic abandoned vague (closing grade partial, no gaps, under cap)
m abandoned-vague "left vague" '
files = sorted((d / "messages").glob("*interviewer.json"))
f = files[2]  # gen_golden order: A0, B0, then A1 — the contract closing admission-jev
t = json.loads(f.read_text())
t["body"] = t["body"].replace("\"grade\": \"solid\"", "\"grade\": \"partial\"")
f.write_text(json.dumps(t))
'

echo
echo "audit-selftest: $pass_n passed, $fail_n failed"
[ "$fail_n" -eq 0 ]
