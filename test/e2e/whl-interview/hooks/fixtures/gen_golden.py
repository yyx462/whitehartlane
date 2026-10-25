#!/usr/bin/env python3
"""gen_golden.py — a deterministic mock exchange for the whl-interview
audit gate (no whl, no tokens, no model). Builds a fake RUN dir (data/
+ messages/ with outbox layout) whose questions come VERBATIM from the
real questions.toml bank, plus a copy of the program's contract/bank/
members so the selftest can mutate the source-side too (stale-section
drills)."""

import json
import shutil
import sys
import tomllib
from pathlib import Path

SOURCE = Path(__file__).resolve().parent.parent.parent
GAPPED = "wakes"  # the golden run carries exactly one gap mark, here


def contract_file(topic, level, question, grade, move, gap_note="", checked="ok"):
    return {
        "topic": topic,
        "level": level,
        "question": question,
        "grade": grade,
        "cited": True,
        "citation_checked": checked,
        "move": move,
        "gap_note": gap_note,
    }


def fenced(c):
    return f"prose.\n\n```turn-contract\n{json.dumps(c)}\n```\n"


def build(target):
    target = Path(target)
    msgs = target / "messages"
    msgs.mkdir(parents=True, exist_ok=True)
    (target / "data").mkdir(parents=True, exist_ok=True)
    # the source side rides along so the selftest can mutate it per case
    for name in ("contract.toml", "questions.toml"):
        shutil.copy2(SOURCE / name, target / name)
    if (target / "members").exists():
        shutil.rmtree(target / "members")
    shutil.copytree(SOURCE / "members", target / "members")

    topics = tomllib.loads((SOURCE / "contract.toml").read_text())["contract"]["topics"]
    bank = tomllib.loads((SOURCE / "questions.toml").read_text()).get("question", [])

    def q_for(topic, level):
        hit = [q["q"] for q in bank if q["topic"] == topic and q["level"] == level]
        return hit[0] if hit else f"fallback {topic} L{level}?"

    seq = 0

    def outbox(owner, body, typ="note"):
        nonlocal seq
        seq += 1
        to = "interviewee" if owner == "interviewer" else "interviewer"
        (msgs / owner).mkdir(parents=True, exist_ok=True)
        (msgs / owner / f"{seq}.json").write_text(
            json.dumps({"from": owner, "to": to, "type": typ, "body": body})
        )

    (target / "data" / "pitch.md").write_text(
        "# whl, pitched\n\nA shell and supervisor for subagent work. Weakest part: accounting.\n"
    )
    (target / "data" / "topic-map.md").write_text(
        "# Topic map\n\n" + "\n".join(f"- {t}" for t in topics) + "\n"
    )
    (target / "data" / "explained.md").write_text(
        "".join(f"## {t}\n\nIt routes turns. See src/engines/coworker.ts:161 for the relay plan.\n\n" for t in topics)
    )
    (target / "data" / "gaps.md").write_text(
        f"## {GAPPED}: gap bookkeeping — severity: medium\n\n"
        "Exposed by: what happens when the gap ledger races the stop?\n"
        "Why it fell short: level-4 answer stayed level-1.\n"
        "Next design question: who owns the gap counter?\n"
        "rebuttal: stands\n"
    )

    outbox("interviewee", "The pitch is at ../../data/pitch.md — whl is a shell and supervisor.")
    # the <=5 commission's golden shape: ONE fresh question per topic
    # (5 topics = the whole list), the gap riding its topic's only turn
    for t in topics:
        move, gap_note = "next", ""
        if t == GAPPED:
            move, gap_note = "gap", "level-4 question answered at level-1 language"
        outbox("interviewer", fenced(contract_file(t, 3, q_for(t, 3), "solid", move, gap_note=gap_note)))
        extra = " Not designed yet." if t == GAPPED else ""
        outbox("interviewee", f"The mechanism: relayPlan filters delivered mail — coworker-run.ts:486.{extra}")

    outbox(
        "interviewer",
        fenced(contract_file("rebuttal", 5, "Here is the gaps list — refute with citations or concede.", "solid", "next")),
    )
    outbox("interviewee", "wakes stands: no counter owner exists in src/.")
    seq += 1
    (msgs / "interviewer" / f"{seq}.json").write_text(
        json.dumps({"from": "interviewer", "to": "interviewee", "type": "stop", "body": "Verdict: five topics solid, one standing gap in wakes."})
    )
    return target


if __name__ == "__main__":
    build(sys.argv[1])
    print(f"golden exchange written to {sys.argv[1]}")
