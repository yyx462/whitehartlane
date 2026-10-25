#!/usr/bin/env python3
"""audit.py — the whl-interview audit gate (the counts hook's engine).

THE SECOND RENDERING of one contract: every law below is READ from
contract.toml (topics, caps, deliverables, gap law, citation pattern)
and questions.toml (the bank). The FIRST rendering is the generated
law section inside each member brief (hooks/render_contract.py); this
audit refuses a run whose briefs carry a stale section — one source,
two renderings, drift impossible (the attempt-3 disease: an audit that
demanded a file the instructions never named).

Checks, in order:
  0. probe (no exchange yet) counts zero and passes — the door probes
     the counts hook at booking
  1. every declared DELIVERABLE exists, is non-empty, and has its
     declared kind (#205 — guarantee a deliverable on every commission;
     rail-built ones are built by this audit, never demanded of panes)
  2. the briefs' contract sections are FRESH (render == embedded)
  3. every interviewer note carries exactly one fenced turn-contract
     block, schema-valid (exact keys, legal enums, one "?")
  4. every asked question is IN THE BANK (append before asking, never
     freestyle — the question bank makes "same questions every run"
     true by construction)
  5. topics open in the declared order, never revisited, caps held;
     each closes solid, gap-marked, or at the cap
  6. at least one gap STANDS after the rebuttal pass
  7. explained.md: one cited section per topic; gaps.md: one rebuttal
     verdict line per section; topic-map.md names every topic
  8. the exchange closed deliberately (>=1 stop, none carrying a block)

On PASS: builds data/transcript.jsonl, delivers to interviews/<date>/,
prints ONE JSON counts line (rail-parsed; human words go to stderr).
"""

import json
import os
import re
import shutil
import sys
import tomllib
from datetime import date
from pathlib import Path

# the wire protocol of a graded turn — the audit's own schema, not a
# program deliverable; it lives here, not in contract.toml
CONTRACT_KEYS = {"topic", "level", "question", "grade", "cited", "citation_checked", "move", "gap_note"}
GRADES = {"vague", "partial", "solid"}
CHECKED = {"ok", "wrong", "missing"}
MOVES = {"deeper", "next", "gap"}
REBUTTAL = "rebuttal"
FENCE = re.compile(r"```turn-contract\s*(\{.*?\})\s*```", re.DOTALL)
REBUTTAL_LINE = re.compile(r"^rebuttal:\s*(refuted|stands)\b", re.MULTILINE)

SOURCE_ROOT = Path(os.environ.get("WHL_CONTRACT_DIR") or Path(__file__).resolve().parent.parent)


def say(why):
    print(f"audit: {why}", file=sys.stderr)


def die(why):
    say(f"FAIL — {why}")
    sys.exit(1)


def load_contract(job_dir=None):
    # the run's law is the STAGED copy inside the job dir (the bank the
    # interviewer actually appends to at ../../questions.toml from its
    # sandbox); the source program is the fallback (--verdict probes,
    # selftests that stage their own copies)
    if job_dir is not None and (Path(job_dir) / "contract.toml").is_file():
        root = Path(job_dir)
    else:
        root = SOURCE_ROOT
    contract = tomllib.loads((root / "contract.toml").read_text())["contract"]
    bank_file = root / "questions.toml"
    bank = tomllib.loads(bank_file.read_text()).get("question", []) if bank_file.exists() else []
    return contract, bank


def load_messages(msg_dir):
    rows = []
    paths = list(Path(msg_dir).glob("*.json")) + list(Path(msg_dir).glob("*/*.json"))
    for p in sorted(paths):
        try:
            raw = json.loads(p.read_text())
        except json.JSONDecodeError:
            die(f"message {p.name} is not JSON (the rail refuses it; it must never reach the transcript)")
        seq = int(p.name.replace(".json", "").split("-")[0])
        rows.append({"seq": seq, "file": str(p.relative_to(msg_dir)), **raw})
    rows.sort(key=lambda r: (r["seq"], r["file"]))
    return rows


def validate_contract(block, where):
    try:
        c = json.loads(block)
    except json.JSONDecodeError as e:
        return None, f"{where}: contract is not JSON ({e})"
    if not isinstance(c, dict) or set(c) != CONTRACT_KEYS:
        return None, f"{where}: keys must be exactly {sorted(CONTRACT_KEYS)}"
    if c["topic"] != REBUTTAL and c["topic"] not in TOPICS:
        return None, f"{where}: unknown topic {c['topic']!r}"
    if not isinstance(c["level"], int) or isinstance(c["level"], bool) or not 1 <= c["level"] <= len(LADDER):
        return None, f"{where}: level must be an integer 1-{len(LADDER)}"
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

    # #205 — deliverables first: the commission's product is the point
    kinds = {"md": ".md", "jsonl": ".jsonl", "html": ".html", "png": ".png"}
    for d in CONTRACT["deliverables"]:
        if d.get("rail-built"):
            continue
        p = job_dir / d["path"]
        if not p.is_file() or p.stat().st_size == 0:
            die(f"deliverable '{d['name']}' missing or empty: {d['path']} (#205: every commission guarantees its deliverables)")
        if not p.name.endswith(kinds.get(d["kind"], f".{d['kind']}")):
            die(f"deliverable '{d['name']}' must be of kind {d['kind']}: {d['path']}")

    # the drift-cop: the briefs' law sections must equal the rendering
    sys.path.insert(0, str(SOURCE_ROOT / "hooks"))
    from render_contract import embedded, render  # noqa: E402

    section = render(CONTRACT, BANK)
    for b in sorted((SOURCE_ROOT / "members").glob("*.md")):
        if embedded(b.read_text()) != section:
            die(f"stale contract section in members/{b.name} — run hooks/render_contract.py --write (one source, two renderings; hand-edits fail)")

    messages = load_messages(job_dir / "messages")
    if not messages:
        die("no relayed messages in messages/ — an exchange with no mail is a failed interview")

    stops = [m for m in messages if m["type"] == "stop"]
    if len(stops) == 0:
        die("no stop message — the exchange never closed deliberately")
    for s in stops:
        if FENCE.search(s["body"]):
            die(f"the stop message {s['file']} must not carry a turn-contract block")

    contracts, errors = extract_contracts(messages)

    # the question bank: every asked question is banked (or was appended first)
    banked = {q["q"] for q in BANK if not q.get("retired")}
    for c in contracts:
        if c["topic"] != REBUTTAL and c["question"] not in banked:
            die(f"question not in the bank: \"{c['question'][:70]}\" — append it to questions.toml first (append-only), then ask it")

    # topic order: first occurrences strictly climb the declared map
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
        if turns[t] > TURNS:
            die(f"topic {t} took {turns[t]} turns (cap {TURNS})")
    if not 1 <= turns.get(REBUTTAL, 0) <= REBUTTAL_TURNS:
        die(f"the rebuttal pass is one turn (cap {REBUTTAL_TURNS}), got {turns.get(REBUTTAL, 0)}")

    # THIS commission's requirement, audited: the question list is at
    # most max-questions fresh questions (rebuttal re-asks are not new
    # list entries — they defend a gap the list already holds)
    fresh = [c for c in contracts if c["topic"] != REBUTTAL]
    if len(fresh) > MAX_QUESTIONS:
        die(f"question budget exceeded: {len(fresh)} fresh questions asked, the commission caps the list at {MAX_QUESTIONS}")

    for t in TOPICS:
        idx = max(j for j, c in enumerate(contracts) if c["topic"] == t)
        if idx + 1 >= len(contracts):
            die(f"topic {t} has no closing turn (the exchange stopped grading mid-topic)")
        closing = contracts[idx + 1]
        if closing["grade"] != "solid" and gaps[t] == 0 and turns[t] < TURNS:
            die(f"topic {t} left vague: closing grade {closing['grade']!r}, {gaps[t]} gap marks, {turns[t]}/{TURNS} turns")

    audit_gaps_md(data_dir / "gaps.md", gaps)
    audit_explained_md(data_dir / "explained.md")
    audit_topic_map(data_dir / "topic-map.md")
    return messages, contracts, errors


def audit_gaps_md(path, gaps):
    text = path.read_text()
    sections = re.split(r"^## ", text, flags=re.MULTILINE)[1:]
    if not any(REBUTTAL_LINE.search(s) and "rebuttal: stands" in s for s in sections):
        die("no gap stands after the rebuttal pass — at least one standing gap is the run's product")
    for s in sections:
        head = s.split("\n")[0]
        if not any(t in head for t in TOPICS):
            die(f"gaps.md section '{head[:60]}' names no declared topic")
        lines = REBUTTAL_LINE.findall(s)
        if len(lines) != 1:
            die(f"gaps.md section '{head[:60]}' needs exactly one 'rebuttal: refuted|stands' line, found {len(lines)}")
        topic = next(t for t in TOPICS if t in head)
        if gaps[topic] == 0:
            say(f"note: section '{head[:48]}…' stands without a move=gap mark on {topic} — bookkeeping drift, not fatal")


def audit_explained_md(path):
    text = path.read_text()
    sections = {}
    current = None
    for line in text.split("\n"):
        if re.match(r"^##\s+", line):
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
            die(f"explained.md section for {t} carries no citation ({CITE_KIND}) — the citations are the deliverable")


def audit_topic_map(path):
    text = path.read_text()
    missing = [t for t in TOPICS if t not in text]
    if missing:
        die(f"topic-map.md does not declare: {', '.join(missing)}")


def build_transcript(data_dir, messages, contracts, errors):
    by_file = {}
    for c in contracts:
        by_file[c["file"]] = {k: c[k] for k in CONTRACT_KEYS}
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
    names = [d["path"] for d in CONTRACT["deliverables"]]
    for n in names:
        shutil.copy2(job_dir / n, out / Path(n).name)
    say(f"delivered {len(names)} deliverables -> interviews/{day}/")
    repo = os.environ.get("WHL_INTERVIEW_REPO")
    if repo:
        dest = Path(repo).expanduser() / "interviews" / f"{day}-{job_dir.name}"
        dest.mkdir(parents=True, exist_ok=True)
        for n in names:
            shutil.copy2(job_dir / n, dest / Path(n).name)
        say(f"mirrored to {dest}")


def main():
    global CONTRACT, BANK, TOPICS, TURNS, REBUTTAL_TURNS, MAX_QUESTIONS, LADDER, CITATION, CITE_KIND
    if len(sys.argv) > 1 and sys.argv[1] == "--verdict":
        # #198 — the PRE-RETIRE probe: deliverables exist + briefs fresh.
        # Runs while the panes still live (the rail's verdict hook); red
        # hands the stop's author one revise round naming exactly this.
        # The full transcript law stays at report time (counts).
        CONTRACT, BANK = load_contract(Path.cwd() if (Path.cwd() / "contract.toml").is_file() else None)
        TOPICS = CONTRACT["topics"]
        TURNS = CONTRACT["exchange"]["turns-per-topic"]
        REBUTTAL_TURNS = CONTRACT["exchange"]["rebuttal-turns"]
        MAX_QUESTIONS = CONTRACT["exchange"]["max-questions"]
        LADDER = CONTRACT["exchange"]["ladder"]
        CITATION = re.compile(CONTRACT["citations"]["pattern"])
        CITE_KIND = "file:line"
        for d in CONTRACT["deliverables"]:
            if d.get("rail-built"):
                continue
            p = Path(d["path"])
            if not p.is_file() or p.stat().st_size == 0:
                say(f"deliverable missing: {d['path']} ({d['name']}) — write it, then stop again")
                sys.exit(1)
        sys.path.insert(0, str(SOURCE_ROOT / "hooks"))
        from render_contract import embedded, render  # noqa: E402

        section = render(CONTRACT, BANK)
        for b in sorted((SOURCE_ROOT / "members").glob("*.md")):
            if embedded(b.read_text()) != section:
                say(f"stale contract section in members/{b.name}")
                sys.exit(1)
        say("verdict: deliverables present, briefs fresh")
        return
    job_dir = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WHL_AUDIT_DIR", ".")).resolve()
    if not (job_dir / "messages").is_dir():
        say("probe — no exchange in this dir yet, nothing to audit")
        print(json.dumps({"topics": 0, "graded_turns": 0, "contract_errors": 0, "gaps_standing": 0}))
        return
    # the run's own law: the STAGED contract + bank inside the job dir
    # (what the interviewer actually appended to), source as fallback
    CONTRACT, BANK = load_contract(job_dir)
    TOPICS = CONTRACT["topics"]
    TURNS = CONTRACT["exchange"]["turns-per-topic"]
    REBUTTAL_TURNS = CONTRACT["exchange"]["rebuttal-turns"]
    MAX_QUESTIONS = CONTRACT["exchange"]["max-questions"]
    LADDER = CONTRACT["exchange"]["ladder"]
    CITATION = re.compile(CONTRACT["citations"]["pattern"])
    CITE_KIND = "file:line"
    messages, contracts, errors = audit(job_dir)
    build_transcript(job_dir / "data", messages, contracts, errors)
    deliver(job_dir)
    standing = (job_dir / "data" / "gaps.md").read_text().count("rebuttal: stands")
    say(f"PASS — {len(contracts)} graded turns, {len(errors)} logged contract error(s)")
    print(json.dumps({"topics": len(TOPICS), "graded_turns": len(contracts), "contract_errors": len(errors), "gaps_standing": standing, "deliverables": len(CONTRACT["deliverables"])}))


if __name__ == "__main__":
    main()
