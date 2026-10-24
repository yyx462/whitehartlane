#!/usr/bin/env bash
# audit-selftest.sh — prove the audit gate CHECKS rather than vibes:
# the golden mock exchange must PASS, and each doctored copy must FAIL
# for exactly the reason the gate exists. No whl, no panes, no tokens.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass_n=0
fail_n=0

expect_pass() { # <dir> <label>
  if bash "$here/audit.sh" "$1" >/dev/null 2>&1; then
    pass_n=$((pass_n + 1)); echo "ok   — $2"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected PASS)"; bash "$here/audit.sh" "$1" >&2
  fi
}

expect_fail() { # <dir> <label> <why-substring>
  local out
  if out=$(bash "$here/audit.sh" "$1" 2>&1); then
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected rejection, got PASS)"
  elif [[ "$out" == *"$3"* ]]; then
    pass_n=$((pass_n + 1)); echo "ok   — $2 (bites: $3)"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (bit for the wrong reason: $out)"
  fi
}

python3 "$here/fixtures/gen_golden.py" "$work/golden" >/dev/null
bash "$here/audit.sh" "$work/golden" >/dev/null
[ -s "$work/golden/data/transcript.jsonl" ] || { echo "FAIL — transcript.jsonl not built"; exit 1; }
[ -s "$work/golden/interviews/$(date +%F)/gaps.md" ] || { echo "FAIL — interviews/<date>/ not delivered"; exit 1; }
pass_n=$((pass_n + 1)); echo "ok   — golden exchange passes, transcript built, artifacts delivered"

m() { # <label> <why> <python-mutation>
  local d="$work/$1"
  cp -R "$work/golden" "$d"
  WHL_DIR="$d" python3 - "$d" <<PYEOF
import sys
sys.path.insert(0, "$here/fixtures")
from pathlib import Path
d = Path("$d")
$3
PYEOF
  expect_fail "$d" "$1" "$2"
}

# 1. zero gap marks = the interviewer was too soft (the brief's own law)
m zero-gaps "zero gap marks" '
import json
for f in sorted((d / "data/messages").glob("*interviewer.json")):
    body = json.loads(f.read_text())["body"]
    if "gap" in body and "races" in body:
        f.unlink()
g = d / "data/gaps.md"
g.write_text(g.read_text().replace("rebuttal: stands\n", "").replace("## wakes", "## zz-wakes-archived"))
'

# 2. three consecutive malformed contracts — the one-re-ask law caps it
m malformed-run "malformed 3 times in a row" '
import json
files = sorted((d / "data/messages").glob("*interviewer.json"))[:3]
for f in files:
    f.write_text(json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                             "body": "question without a contract block"}))
'

# 3. a topic past the 6-turn cap
m turn-cap "took 7 turns" '
import json
files = sorted((d / "data/messages").glob("*.json"))
last = files[-1]
seq = int(last.name.split("-")[0])
extra = []
for n in range(5):
    c = {"topic": "admission-jev", "level": 4, "question": f"Break it again {n}?",
         "grade": "partial", "cited": True, "citation_checked": "ok",
         "move": "deeper", "gap_note": ""}
    extra.append((seq + 1 + n * 2, "interviewer", f"prose.\n\n```turn-contract\n{json.dumps(c)}\n```"))
for s, frm, body in extra:
    (d / "data/messages" / f"{s:03d}-{frm}.json").write_text(
        json.dumps({"from": frm, "to": "interviewee", "type": "note", "body": body}))
'

# 4. no standing gap after rebuttal = nothing survives = too soft
m no-stands "no gap stands" '
g = d / "data/gaps.md"
g.write_text(g.read_text().replace("rebuttal: stands", "rebuttal: refuted — src/engines/coworker.ts:161"))
'

# 5. topics opened out of the declared order
m topic-order "topics must open in declared order" '
import json, re
first = sorted((d / "data/messages").glob("*interviewer.json"))[0]
txt = json.loads(first.read_text())
txt["body"] = txt["body"].replace("\"topic\": \"admission-jev\"", "\"topic\": \"spur-grammar\"")
first.write_text(json.dumps(txt))
'

# 6. a topic abandoned vague (closing grade partial, no gaps, under cap)
m abandoned-vague "left vague" '
import json
files = sorted((d / "data/messages").glob("*interviewer.json"))
f = files[2]  # gen_golden order: A0, B0, then A1 — the contract closing admission-jev
t = json.loads(f.read_text())
t["body"] = t["body"].replace("\"grade\": \"solid\"", "\"grade\": \"partial\"")
f.write_text(json.dumps(t))
'

echo
echo "audit-selftest: $pass_n passed, $fail_n failed"
[ "$fail_n" -eq 0 ]
