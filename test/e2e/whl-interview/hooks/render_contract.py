#!/usr/bin/env python3
"""render_contract.py — the FIRST rendering of the one contract: the
law section glued inside each member brief. The SECOND rendering is
hooks/audit.py, which reads contract.toml directly. One source, two
renderings — a brief whose section does not match this file fails the
audit, so hand-edited prose can never again drift from the machine's
demands (the attempt-3 disease: the audit demanded topic-map.md the
instructions never named).

  render   (default)  print the law section to stdout
  --write             replace the marked section in members/*.md
  --check             exit 1 naming any brief whose section is stale
"""

import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def load():
    contract = tomllib.loads((HERE / "contract.toml").read_text())["contract"]
    bank = tomllib.loads((HERE / "questions.toml").read_text())
    return contract, bank.get("question", [])


def render(contract: dict, questions: list) -> str:
    topics = contract["topics"]
    ex = contract["exchange"]
    lines = [
        "## THE AUDIT'S LAW (generated from contract.toml — do not edit;",
        "## a hand-edited section here FAILS the run)",
        "",
        "**Deliverables — the run's product, checked for existence, size,",
        "and kind; a missing or empty one fails the run (#205: every",
        "commission guarantees a deliverable):**",
    ]
    for d in contract["deliverables"]:
        who = "the AUDIT builds this — never demanded of you" if d.get("rail-built") else "YOU must write this"
        lines.append(f"- `{d['path']}` ({d['kind']}) — {who}")
    lines += [
        "",
        f"**Topic map (fixed order, never revisited):** {', '.join(topics)}.",
        f"**THE REQUIREMENT FOR THIS COMMISSION: the question list is at",
        f"most {ex['max-questions']} questions — the WHOLE interview, all",
        "topics combined. Five topics, one fresh question each; you cannot",
        "climb the whole ladder, so per topic pick the single sharpest",
        "question the bank holds (or append one it lacks). A second fresh",
        "question anywhere spends the list — the audit refuses a run that",
        "asks more than the list allows.",
        f"**Ladder (the levels you draw from, sharpest wins):** {' -> '.join(ex['ladder'])}.",
        f"**Turns:** at most {ex['turns-per-topic']} per topic and {ex['max-questions']} fresh",
        f"questions in total; a topic stops at grade=solid, 3 gap marks, or",
        f"the cap. The rebuttal pass is {ex['rebuttal-turns']} turns at most",
        f"**Gaps:** at least {contract['gaps']['must-stand']} must STAND after the",
        "rebuttal pass — zero standing gaps means the interviewer was too",
        "soft and the run fails.",
        "**Questions:** every question you ask must come from the bank",
        f"({contract['questions']['bank']}) — at run time that is the staged",
        "copy at `../../questions.toml` (from your sandbox). If you need a",
        "question it lacks, APPEND it there first (append-only; retire with",
        "`retired = true`, never erase), then ask it. The audit checks every",
        "asked question is banked in THAT copy — the run's own law.",
        "**Citations:** every claim in an answer and every explained.md",
        "section carries at least one repo citation — `path/file.ts` or",
        "`path/file.ts:LINE`.",
    ]
    return "\n".join(lines)


MARK_START = "<!-- contract-rendered:start -->"
MARK_END = "<!-- contract-rendered:end -->"


def embedded(brief: str) -> str | None:
    if MARK_START not in brief or MARK_END not in brief:
        return None
    return brief.split(MARK_START, 1)[1].split(MARK_END, 1)[0].strip("\n")


def with_section(brief: str, section: str) -> str:
    if MARK_START in brief and MARK_END in brief:
        head = brief.split(MARK_START, 1)[0]
        tail = brief.split(MARK_END, 1)[1]
        return f"{head}{MARK_START}\n{section}\n{MARK_END}{tail}"
    return f"{brief.rstrip()}\n\n{MARK_START}\n{section}\n{MARK_END}\n"


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "render"
    contract, questions = load()
    section = render(contract, questions)
    if mode == "render":
        print(section)
        return
    members = HERE / "members"
    briefs = sorted(members.glob("*.md")) if members.is_dir() else []
    if mode == "--write":
        if not briefs:
            sys.exit("no members/*.md to render into")
        for b in briefs:
            b.write_text(with_section(b.read_text(), section))
        print(f"rendered the contract section into {len(briefs)} brief(s)")
        return
    if mode == "--check":
        stale = [b.name for b in briefs if embedded(b.read_text()) != section]
        if not briefs:
            sys.exit("no members/*.md to check")
        if stale:
            sys.exit(f"stale contract section (contract.toml or questions.toml changed): {', '.join(stale)} — run hooks/render_contract.py --write")
        print(f"contract section fresh in {len(briefs)} brief(s), {len(questions)} banked questions")
        return
    sys.exit("usage: render_contract.py [render|--write|--check]")


if __name__ == "__main__":
    main()
