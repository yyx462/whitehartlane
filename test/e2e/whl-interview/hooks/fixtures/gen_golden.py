#!/usr/bin/env python3
"""gen_golden.py — a deterministic mock exchange for the whl-interview
audit gate (no whl, no tokens, no model). Builds a run tree under the
target directory: data/{pitch,topic-map,explained,gaps}.md plus the raw
relay mail in data/messages/. The selftest (audit-selftest.sh) plays it
through audit.py and then mutates copies to prove each gate check bites.
"""

import json
import sys
from pathlib import Path

TOPICS = [
    "admission-jev",
    "pane-supervision",
    "spur-grammar",
    "wakes",
    "accounting",
    "relay-protocol",
]
GAPPED = "wakes"  # the golden run carries exactly one gap mark, here


def contract(topic, level, question, grade, move, gap_note="", checked="ok"):
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
    msgs = target / "data" / "messages"
    msgs.mkdir(parents=True, exist_ok=True)
    seq = 0

    def note(frm, body, to=None, typ="note"):
        nonlocal seq
        to = to or ("interviewee" if frm == "interviewer" else "interviewer")
        seq += 1
        (msgs / f"{seq:03d}-{frm}.json").write_text(
            json.dumps({"from": frm, "to": to, "type": typ, "body": body})
        )

    def stop(frm, body):
        nonlocal seq
        seq += 1
        (msgs / f"{seq:03d}-{frm}.json").write_text(
            json.dumps({"from": frm, "to": "interviewee", "type": "stop", "body": body})
        )

    (target / "data" / "pitch.md").write_text(
        "# whl, pitched\n\nA shell and supervisor for subagent work. Weakest part: accounting.\n"
    )
    (target / "data" / "topic-map.md").write_text(
        "# Topic map\n\n" + "\n".join(f"- {t}" for t in TOPICS) + "\n"
    )
    (target / "data" / "explained.md").write_text(
        "".join(
            f"## {t}\n\nIt routes turns. See src/engines/coworker.ts:161 for the relay plan.\n\n"
            for t in TOPICS
        )
    )
    (target / "data" / "gaps.md").write_text(
        f"## {GAPPED}: gap bookkeeping — severity: medium\n\n"
        "Exposed by: what happens when the gap ledger races the stop?\n"
        "Why it fell short: level-4 answer stayed level-1.\n"
        "Next design question: who owns the gap counter?\n"
        "rebuttal: stands\n"
    )

    note("interviewee", "The pitch is at ../../data/pitch.md — whl is a shell and supervisor.")
    for i, t in enumerate(TOPICS):
        closing = "solid" if i > 0 else "partial"
        note(
            "interviewer",
            fenced(
                contract(
                    t, 1, f"What does {t} do, in one sentence?", closing,
                    "next" if i > 0 else "deeper",
                )
            ),
        )
        note("interviewee", f"{t} routes turns — src/engines/coworker.ts:161.")
        extra = ""
        if t == GAPPED:
            note(
                "interviewer",
                fenced(
                    contract(
                        t, 3, f"What happens when {t} races a stop?", "partial",
                        "gap", gap_note="level-4 question answered at level-1 language",
                    )
                ),
            )
            extra = " Not designed yet."
        note("interviewee", f"The mechanism: relayPlan filters delivered mail — coworker-run.ts:486.{extra}")
        note(
            "interviewer",
            fenced(
                contract(t, 2, f"How does {t} work, walking the code?", "partial", "deeper")
            ),
        )

    note(
        "interviewer",
        fenced(
            contract(
                "rebuttal", 5,
                "Here is the gaps list — refute with citations or concede.",
                "solid", "next",
            )
        ),
    )
    note("interviewee", "wakes stands: no counter owner exists in src/.")
    stop("interviewer", "Verdict: five topics solid, one standing gap in wakes.")
    return target


if __name__ == "__main__":
    build(sys.argv[1])
    print(f"golden exchange written to {sys.argv[1]}")
