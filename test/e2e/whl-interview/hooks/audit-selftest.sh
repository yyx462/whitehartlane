#!/usr/bin/env bash
# audit-selftest.sh — prove the contract-driven audit CHECKS rather than
# vibes: the golden mock exchange (built from the REAL bank) must PASS
# with one JSON counts line, and each doctored copy must FAIL for the
# reason its check exists. No whl, no panes, no tokens.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
pass_n=0
fail_n=0

run_audit() { # <dir> — env points BOTH roots at the fixture copy
  WHL_AUDIT_DIR="$1" WHL_CONTRACT_DIR="$1" python3 "$here/audit.py" "$1" 2>/dev/null
}

expect_pass() { # <dir> <label>
  local out
  if out=$(run_audit "$1") && echo "$out" | tail -1 | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
    pass_n=$((pass_n + 1)); echo "ok   — $2 (counts JSON: $(echo "$out" | tail -1))"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected PASS + JSON counts)"; WHL_AUDIT_DIR="$1" WHL_CONTRACT_DIR="$1" python3 "$here/audit.py" "$1" >&2
  fi
}

expect_fail() { # <dir> <label> <why-substring>
  local out
  if out=$(WHL_AUDIT_DIR="$1" WHL_CONTRACT_DIR="$1" python3 "$here/audit.py" "$1" 2>&1); then
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (expected rejection, got PASS)"
  elif [[ "$out" == *"$3"* ]]; then
    pass_n=$((pass_n + 1)); echo "ok   — $2 (bites: $3)"
  else
    fail_n=$((fail_n + 1)); echo "FAIL — $2 (bit for the wrong reason: $out)"
  fi
}

python3 "$here/fixtures/gen_golden.py" "$work/golden" >/dev/null
expect_pass "$work/golden" "golden exchange passes with JSON counts"

# the pre-retire probe (#198): deliverables present = green; a missing
# one = red naming the artifact — the revise round's ammunition
cp -R "$work/golden" "$work/golden-pristine"
if (cd "$work/golden" && WHL_CONTRACT_DIR="$here/.." python3 "$here/audit.py" --verdict >/dev/null 2>&1); then
  pass_n=$((pass_n + 1)); echo "ok   — verdict probe green on the golden tree"
else
  fail_n=$((fail_n + 1)); echo "FAIL — verdict probe should be green on golden"
fi
rm "$work/golden/data/pitch.md"
if out=$(cd "$work/golden" && WHL_CONTRACT_DIR="$here/.." python3 "$here/audit.py" --verdict 2>&1); then
  fail_n=$((fail_n + 1)); echo "FAIL — verdict probe should bite on a missing deliverable"
elif [[ "$out" == *"deliverable missing"* ]]; then
  pass_n=$((pass_n + 1)); echo "ok   — verdict probe bites: deliverable missing (names the artifact)"
else
  fail_n=$((fail_n + 1)); echo "FAIL — verdict probe bit for the wrong reason: $out"
fi
cp "$work/golden-pristine/data/pitch.md" "$work/golden/data/pitch.md"
[ -s "$work/golden/data/transcript.jsonl" ] || { echo "FAIL — transcript.jsonl not built"; exit 1; }
# the human pack: the readable skeleton — wrapped prose, canonical
# questions, demoted grading notes, no run-mechanics plots (a plot of
# the ANSWER needs a mind; deterministic code does layout only)
iv="$work/golden/deliverables/interview.md"
[ -s "$iv" ] || { echo "FAIL — deliverables/interview.md not rendered"; exit 1; }
grep -q "^\*\*Interviewer:\*\*" "$iv" || { echo "FAIL — interview.md has no Interviewer: turns"; exit 1; }
grep -q "^\*\*Me:\*\*" "$iv" || { echo "FAIL — interview.md has no Me: turns"; exit 1; }
grep -q "^| # | topic | asked | gaps | closed |" "$iv" || { echo "FAIL — interview.md needs the climb table"; exit 1; }
grep -q "^\*(graded " "$iv" || { echo "FAIL — interview.md needs per-answer grade annotations"; exit 1; }
grep -q "turn-contract" "$iv" && { echo "FAIL — interview.md must strip the turn-contract chrome"; exit 1; }
grep -q '```mermaid' "$iv" && { echo "FAIL — the deterministic skeleton draws no plots (content plots are the refining pass's job)"; exit 1; }
awk 'length > 80 { bad = 1 } END { exit bad }' "$iv" || { echo "FAIL — interview.md lines must wrap at <= 80 cols (walls are unreadable)"; exit 1; }
grep -q "What still stands" "$iv" || { echo "FAIL — interview.md must end with the standing list"; exit 1; }
pass_n=$((pass_n + 1)); echo "ok   — interview.md rendered: wrapped skeleton, canonical questions, notes demoted, no walls"
# the pack's law: a file lives in deliverables/ ONLY if no agent needs
# to read it — exactly ONE file today. The member docs (pitch is read
# by the interviewer; the other three by the audit) are working files
# and live in data/ with the bank and the machine transcript.
[ "$(ls "$work/golden/deliverables")" = "interview.md" ] || { echo "FAIL — deliverables/ must hold exactly interview.md, found: $(ls "$work/golden/deliverables" | tr '\n' ' ')"; exit 1; }
for f in pitch.md topic-map.md explained.md gaps.md; do
  [ -s "$work/golden/data/$f" ] || { echo "FAIL — working file data/$f missing from the working shelf"; exit 1; }
done
[ ! -d "$work/golden/interviews" ] || { echo "FAIL — interviews/ copy shelf must not exist"; exit 1; }
pass_n=$((pass_n + 1)); echo "ok   — pack law holds: deliverables/ = interview.md alone; working files in data/"

m() { # <label> <why> <python-mutation>
  local d="$work/$1"
  cp -R "$work/golden" "$d"
  python3 - "$d" <<PYEOF
import json
import sys
from pathlib import Path
d = Path(sys.argv[1])
$3
PYEOF
  expect_fail "$d" "$1" "$2"
}

# 1. a missing deliverable fails the run (#205 — the commission's product)
m missing-deliverable "deliverable" '
(d / "data" / "pitch.md").unlink()
'

# 2. zero standing gap sections = the interviewer was too soft
m zero-gaps "no gap stands" '
import pathlib
for f in sorted((d / "messages" / "interviewer").glob("*.json")):
    body = json.loads(f.read_text())["body"]
    if "gap" in body and "races" in body:
        f.unlink()
g = d / "data" / "gaps.md"
g.write_text("# Gaps\n\nNone found — everything checked out.\n")
'

# 3. three consecutive malformed contracts — the one-re-ask law caps it
m malformed-run "malformed 3 times in a row" '
files = sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0]))[:3]
for f in files:
    f.write_text(json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                             "body": "question without a contract block"}))
'

# 4. a topic past the turn cap — the appended turns are DISTINCT banked
# questions (supersession collapses re-statements, so a cap test must
# spend real distinct questions)
m turn-cap "took 5 turns (cap 2)" '
import tomllib
bank = tomllib.loads((d / "data" / "questions.toml").read_text())["question"]
qs = [x["q"] for x in bank if x["topic"] == "admission-jev"]
files = sorted((d / "messages").glob("*/*.json"))
seq = max(int(f.name.split(".")[0]) for f in files)
bt = chr(96)
fence = bt * 3
for n in range(5):
    c = {"topic": "admission-jev", "level": 4, "question": qs[n % len(qs)],
         "grade": "partial", "cited": True, "citation_checked": "ok",
         "move": "deeper", "gap_note": ""}
    s = seq + 1 + n
    (d / "messages" / "interviewer" / f"{s}.json").write_text(
        json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                    "body": "prose.\n\n" + fence + "turn-contract\n" + json.dumps(c) + "\n" + fence}))
'

# 5. topics opened out of the declared order
m topic-order "topics must open in declared order" '
first = sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0]))[0]
txt = json.loads(first.read_text())
txt["body"] = txt["body"].replace("\"topic\": \"admission-jev\"", "\"topic\": \"spur-grammar\"")
first.write_text(json.dumps(txt))
'

# 4b. gap_note is conditional: omitted on a non-gap turn the contract
# still parses (run #8's interviewer omitted it three times); omitted
# on a gap turn it still dies
cp -R "$work/golden" "$work/golden-nogap"
python3 - "$work/golden-nogap" <<'PYG'
import json, re, sys
from pathlib import Path
d = Path(sys.argv[1])
for f in sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0])):
    body = json.loads(f.read_text())
    m = re.search(r"turn-contract\s*(\{.*?\})\s*```", body["body"], re.DOTALL)
    if not m:
        continue
    c = json.loads(m.group(1))
    if c.get("move") != "gap" and c.get("gap_note") == "":
        del c["gap_note"]
        body["body"] = body["body"].replace(m.group(1), json.dumps(c))
        f.write_text(json.dumps(body))
        break
PYG
expect_pass "$work/golden-nogap" "an omitted gap_note on a non-gap turn parses"

cp -R "$work/golden" "$work/golden-nogaplen"
python3 - "$work/golden-nogaplen" <<'PYG'
import json, re, sys
from pathlib import Path
d = Path(sys.argv[1])
for f in sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0])):
    body = json.loads(f.read_text())
    m = re.search(r"turn-contract\s*(\{.*?\})\s*```", body["body"], re.DOTALL)
    if not m:
        continue
    c = json.loads(m.group(1))
    if c.get("move") == "gap":
        del c["gap_note"]
        body["body"] = body["body"].replace(m.group(1), json.dumps(c))
        f.write_text(json.dumps(body))
        break
PYG
# the dropped turn cascades: wakes never opens, the order check dies
expect_fail "$work/golden-nogaplen" "gap without a note kills the run" "topics must open in declared order"

# 5a. a SUPERSEDED re-statement: re-asking an already-asked question
# (a re-grade, a mis-file the interviewer corrects by name) is not a
# new list entry — the golden plus one duplicate turn still PASSES
cp -R "$work/golden" "$work/golden-dup"
python3 - "$work/golden-dup" <<'PYD'
import json, re, sys
from pathlib import Path
d = Path(sys.argv[1])
# find an already-asked golden question (the first topic's contract)
for f in sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0])):
    body = json.loads(f.read_text())["body"]
    m = re.search(r"turn-contract\s*(\{.*?\})\s*```", body, re.DOTALL)
    if not m:
        continue
    c = json.loads(m.group(1))
    if c.get("topic") and c["topic"] != "rebuttal":
        dup = dict(c)
        break
seq = max(int(p.name.split(".")[0]) for p in (d / "messages").glob("*/*.json"))
fence = chr(96) * 3
(d / "messages" / "interviewer" / f"{seq + 1}.json").write_text(
    json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                "body": "correction: my last block was mis-filed; this supersedes it.\n\n" + fence + "turn-contract\n" + json.dumps(dup) + "\n" + fence}))
PYD
expect_pass "$work/golden-dup" "a superseded re-statement does not blow the budget"

# 5b. a SIXTH fresh question — over the commission's question budget
# (one extra banked question on an already-opened topic: per-topic cap
# 2 is respected, the budget is not)
m budget-cap "question budget exceeded" '
import tomllib
bank = tomllib.loads((d / "data" / "questions.toml").read_text())["question"]
q = next(x["q"] for x in bank if x["topic"] == "admission-jev" and x["level"] == 4)
files = sorted((d / "messages").glob("*/*.json"))
seq = max(int(f.name.split(".")[0]) for f in files)
bt = chr(96)
fence = bt * 3
c = {"topic": "admission-jev", "level": 4, "question": q,
     "grade": "partial", "cited": True, "citation_checked": "ok",
     "move": "deeper", "gap_note": ""}
(d / "messages" / "interviewer" / f"{seq + 1}.json").write_text(
    json.dumps({"from": "interviewer", "to": "interviewee", "type": "note",
                "body": "one more.\n\n" + fence + "turn-contract\n" + json.dumps(c) + "\n" + fence}))
'

# 6. an unbanked question — freestyling fails, append-first is the law
m unbanked-question "not in the bank" '
first = sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0]))[0]
txt = json.loads(first.read_text())
txt["body"] = txt["body"].replace("?", " — really?")
first.write_text(json.dumps(txt))
'

# 7. a stale generated section in a brief — the drift-cop bites
m stale-brief "stale contract section" '
b = d / "members" / "interviewer.md"
b.write_text(b.read_text().replace("generated from contract.toml", "hand-written just now", 1))
'

# 8. a topic abandoned vague (closing grade partial, no gaps, under cap)
m abandoned-vague "left vague" '
files = sorted((d / "messages" / "interviewer").glob("*.json"), key=lambda p: int(p.name.split(".")[0]))
f = files[2]  # gen_golden order: A0, B0, then A1 — the contract closing admission-jev
t = json.loads(f.read_text())
t["body"] = t["body"].replace("\"grade\": \"solid\"", "\"grade\": \"partial\"")
f.write_text(json.dumps(t))
'

echo
echo "audit-selftest: $pass_n passed, $fail_n failed"
[ "$fail_n" -eq 0 ]
