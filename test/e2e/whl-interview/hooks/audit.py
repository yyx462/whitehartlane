#!/usr/bin/env python3
"""audit.py — the whl-interview audit gate (the counts hook's engine).

Judges the exchange in <run-dir> against the turn contract:
  1. every interviewer note carries exactly one fenced ```turn-contract
     block, schema-valid (exact keys, legal enums, one question, one "?")
  2. a malformed block is re-asked at most once (a run of >2 consecutive
     malformed blocks fails); every error is logged into transcript.jsonl
  3. topics appear in declared order, never revisited; each <= 6 turns;
     each closes solid, or on >=1 gap mark, or at the 6-turn cap
  4. at least one gap mark exists and at least one STANDS after the
     rebuttal pass (zero standing gaps = the interviewer was too soft)
  5. explained.md has one cited section per topic; gaps.md one rebuttal-
     annotated section per gapped topic; the stop message exists

On PASS it builds data/transcript.jsonl, delivers the artifacts to
interviews/<date>/ under the run dir (mirroring to
$WHL_INTERVIEW_REPO/interviews/<date>-<job>/ when set) and prints ONE
JSON counts line on stdout — the rail parses counts stdout strictly, so
every human-readable word goes to stderr and a FAIL exits nonzero
(failing the run's report honestly).
"""

import json
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

TOPICS = [
    "admission-jev",
    "pane-supervision",
    "spur-grammar",
    "wakes",
    "accounting",
    "relay-protocol",
]
REBUTTAL = "rebuttal"
CONTRACT_KEYS = {
    "topic",
    "level",
    "question",
    "grade",
    "cited",
    "citation_checked",
    "move",
    "gap_note",
}
GRADES = {"vague", "partial", "solid"}
CHECKED = {"ok", "wrong", "missing"}
MOVES = {"deeper", "next", "gap"}
TOPIC_TURNS = 6
REBUTTAL_TURNS = 2
FENCE = re.compile(r"```turn-contract\s*(\{.*?\})\s*```", re.DOTALL)
CITATION = re.compile(r"[A-Za-z0-9_./~-]+\.(?:ts|mts|mjs|js|md|toml|sh|py)(?::\d+)?")
REBUTTAL_LINE = re.compile(r"^rebuttal:\s*(refuted|stands)\b", re.MULTILINE)


def say(why):
    print(f"audit: {why}", file=sys.stderr)


def die(why):
    say(f"FAIL — {why}")
    sys.exit(1)


def load_messages(msg_dir):
    rows = []
    for p in sorted(Path(msg_dir).glob("*.json")):
        try:
            raw = json.loads(p.read_text())
        except json.JSONDecodeError:
            die(f"message {p.name} is not JSON (the rail refuses it; it must never reach the transcript)")
        seq = int(p.name.split("-")[0])
        rows.append({"seq": seq, "file": p.name, **raw})
    rows.sort(key=lambda r: (r["seq"], r["file"]))
    return rows


def validate_contract(block, where):
    """Return (contract, None) or (None, why)."""
    try:
        c = json.loads(block)
    except json.JSONDecodeError as e:
        return None, f"{where}: contract is not JSON ({e})"
    if not isinstance(c, dict) or set(c) != CONTRACT_KEYS:
        return None, f"{where}: keys must be exactly {sorted(CONTRACT_KEYS)}"
    if c["topic"] not in TOPICS and c["topic"] != REBUTTAL:
        return None, f"{where}: unknown topic {c['topic']!r}"
    if not isinstance(c["level"], int) or isinstance(c["level"], bool) or not 1 <= c["level"] <= 5:
        return None, f"{where}: level must be an integer 1-5"
    if c["grade"] not in GRADES:
        return None, f"{where}: grade must be one of {sorted(GRADES)}"
    if not isinstance(c["cited"], bool):
        return None, f"{where}: cited must be true or false"
    if c["citation_checked"] not in CHECKED:
        return None, f"{where}: citation_checked must be one of {sorted(CHECKED)}"
    if c["move"] not in MOVES:
        return None, f"{where}: move must be one of {sorted(MOVES)}"
    if not isinstance(c["question"], str) or not c["question"].strip():
        return None, f"{where}: question is empty"
    if c["question"].count("?") > 1:
        return None, f"{where}: compound question (more than one '?') — one question per turn"
    if not isinstance(c["gap_note"], str):
        return None, f"{where}: gap_note must be a string"
    if c["move"] == "gap" and not c["gap_note"].strip():
        return None, f"{where}: move=gap requires gap_note"
    return c, None


def extract_contracts(messages):
    """Walk interviewer notes in order; produce contracts + error entries.

    A run of consecutive malformed blocks models the re-ask law: the
    turn is re-asked once, then logged as an error. >2 in a row fails.
    """
    contracts, errors = [], []
    malformed_run = 0
    for m in messages:
        if m["from"] != "interviewer" or m["type"] != "note":
            continue
        where = m["file"]
        fences = FENCE.findall(m["body"])
        block, why = (fences[0], None) if len(fences) == 1 else (None, f"{where}: expected exactly 1 turn-contract fence, found {len(fences)}")
        if block is not None:
            block, why = validate_contract(block, where)
        if block is None:
            malformed_run += 1
            errors.append({"file": where, "why": why})
            if malformed_run > 2:
                die(f"turn-contract malformed 3 times in a row ({where}) — the re-ask law allows one re-ask, then the turn is logged and abandoned")
        else:
            malformed_run = 0
            contracts.append({"file": where, "seq": m["seq"], **block})
    return contracts, errors


def audit(job_dir):
    data_dir = job_dir / "data"
    for doc in ("pitch", "topic-map", "explained", "gaps"):
        if not (data_dir / f"{doc}.md").is_file() or (data_dir / f"{doc}.md").stat().st_size == 0:
            die(f"data/{doc}.md missing or empty")

    messages = load_messages(job_dir / "messages")
    if not messages:
        die("no relayed messages in messages/ — an exchange with no mail is a failed interview")

    stops = [m for m in messages if m["type"] == "stop" and m["from"] == "interviewer"]
    if len(stops) != 1:
        die(f"expected exactly 1 interviewer stop message, found {len(stops)}")
    if FENCE.search(stops[0]["body"]):
        die("the stop message must not carry a turn-contract block")

    contracts, errors = extract_contracts(messages)

    # topic order: first occurrences strictly climb the declared map,
    # rebuttal comes last, no revisits
    seen, order = [], []
    for c in contracts:
        if c["topic"] not in seen:
            seen.append(c["topic"])
            order.append(c["topic"])
    expected = TOPICS + [REBUTTAL]
    if order != expected:
        die(f"topics must open in declared order {expected}, got {order}")

    turns, gaps = {}, {t: 0 for t in TOPICS}
    for c in contracts:
        turns[c["topic"]] = turns.get(c["topic"], 0) + 1
        if c["topic"] in gaps and c["move"] == "gap":
            gaps[c["topic"]] += 1
    for t in TOPICS:
        if turns.get(t, 0) == 0:
            die(f"topic {t} never opened")
        if turns[t] > TOPIC_TURNS:
            die(f"topic {t} took {turns[t]} turns (cap {TOPIC_TURNS})")
    if not 1 <= turns.get(REBUTTAL, 0) <= REBUTTAL_TURNS:
        die(f"the rebuttal pass is one turn (cap {REBUTTAL_TURNS}), got {turns.get(REBUTTAL, 0)}")

    # closure: a topic ends solid (the NEXT contract's grade — it grades
    # this topic's last answer), or on >=1 gap mark, or at the turn cap
    for t in TOPICS:
        idx = max(j for j, c in enumerate(contracts) if c["topic"] == t)
        if idx + 1 >= len(contracts):
            die(f"topic {t} has no closing turn (the exchange stopped grading mid-topic)")
        closing = contracts[idx + 1]
        if closing["grade"] != "solid" and gaps[t] == 0 and turns[t] < TOPIC_TURNS:
            die(f"topic {t} left vague: closing grade {closing['grade']!r}, {gaps[t]} gap marks, {turns[t]}/{TOPIC_TURNS} turns")

    if sum(gaps.values()) == 0:
        die("zero gap marks — the interviewer was too soft")

    audit_gaps_md(data_dir / "gaps.md", gaps)
    audit_explained_md(data_dir / "explained.md")
    audit_topic_map(data_dir / "topic-map.md")
    return messages, contracts, errors


def audit_gaps_md(path, gaps):
    text = path.read_text()
    sections = re.split(r"^## ", text, flags=re.MULTILINE)[1:]
    gapped = [t for t in TOPICS if gaps[t] > 0]
    # the brief's law is one section PER GAP (a topic can bank several),
    # so: every gapped topic is named by >=1 section, and every section
    # carries exactly one rebuttal verdict line
    for t in gapped:
        hit = [s for s in sections if t in s.split("\n")[0]]
        if len(hit) < 1:
            die(f"gaps.md has no section naming gapped topic {t} (sections found: {len(sections)})")
    for s in sections:
        head = s.split("\n")[0]
        lines = REBUTTAL_LINE.findall(s)
        if len(lines) != 1:
            die(f"gaps.md section '{head[:60]}' needs exactly one 'rebuttal: refuted|stands' line, found {len(lines)}")
    if text.count("rebuttal: stands") == 0:
        die("no gap stands after the rebuttal pass — at least one standing gap is the run's product")


def audit_explained_md(path):
    text = path.read_text()
    sections = {}
    current = None
    for line in text.split("\n"):
        m = re.match(r"^##\s+", line)
        if m:
            current = line
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    for t in TOPICS:
        hit = [h for h in sections if t in h]
        if len(hit) != 1:
            die(f"explained.md must have exactly one section per topic; {t} found {len(hit)}")
        body = "\n".join(sections[hit[0]])
        if not CITATION.search(body):
            die(f"explained.md section for {t} carries no citation (file:line) — the citations are the deliverable")


def audit_topic_map(path):
    text = path.read_text()
    missing = [t for t in TOPICS if t not in text]
    if missing:
        die(f"topic-map.md does not declare: {', '.join(missing)}")


def build_transcript(data_dir, messages, contracts, errors):
    by_file = {}
    for c in contracts:
        by_file[c["file"]] = {
            k: c[k] for k in ("topic", "level", "question", "grade", "cited", "citation_checked", "move", "gap_note")
        }
    lines = []
    for m in messages:
        row = {k: m[k] for k in ("seq", "file", "from", "to", "type")}
        if m["file"] in by_file:
            row["contract"] = by_file[m["file"]]
        lines.append(row)
    out = {"run": data_dir.resolve().parent.name, "turns": len(contracts), "contract_errors": errors, "messages": lines}
    (data_dir / "transcript.jsonl").write_text(json.dumps(out, indent=2) + "\n")


def deliver(job_dir):
    day = date.today().isoformat()
    out = job_dir / "interviews" / day
    out.mkdir(parents=True, exist_ok=True)
    names = ["pitch.md", "topic-map.md", "explained.md", "gaps.md", "transcript.jsonl"]
    for n in names:
        shutil.copy2(job_dir / "data" / n, out / n)
    say(f"delivered {', '.join(names)} -> interviews/{day}/")
    repo = os.environ.get("WHL_INTERVIEW_REPO")
    if repo:
        dest = Path(repo).expanduser() / "interviews" / f"{day}-{job_dir.name}"
        dest.mkdir(parents=True, exist_ok=True)
        for n in names:
            shutil.copy2(job_dir / "data" / n, dest / n)
        say(f"mirrored to {dest}")


def main():
    job_dir = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WHL_AUDIT_DIR", ".")).resolve()
    if not (job_dir / "messages").is_dir():
        # the door probes the counts hook at booking, before any exchange
        # exists; a real run dir always carries messages/ (the engine
        # creates it at start). A probe has nothing to audit — say so and
        # count zero, never fail the booking.
        say("probe — no exchange in this dir yet, nothing to audit")
        print(json.dumps({"topics": 0, "graded_turns": 0, "contract_errors": 0, "gaps_standing": 0}))
        return
    messages, contracts, errors = audit(job_dir)
    build_transcript(job_dir / "data", messages, contracts, errors)
    deliver(job_dir)
    standing = (job_dir / "data" / "gaps.md").read_text().count("rebuttal: stands")
    say(f"PASS — {len(contracts)} graded turns, {len(errors)} logged contract error(s)")
    # counts stdout is parsed strictly by the rail — one JSON line, last
    print(json.dumps({"topics": len(TOPICS), "graded_turns": len(contracts), "contract_errors": len(errors), "gaps_standing": standing}))


if __name__ == "__main__":
    main()
