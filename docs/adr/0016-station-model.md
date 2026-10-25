# ADR 0016 — the station model

Date: 2026-10-25. Zen: docs/zen/2026-10-25-zen-7.md (Final lines).
Status: proposed (slices land under a fresh commissioning).

## Context

A hybrid chain (a conversation or experiment stage inside a chain)
delegates by MINTING a copy of the stage into `stages/<id>/` and
launching it as a CHILD JOB. Receipts of the cost: j-36f78c and
j-c93562 (the child's door re-screens the copy, which can never carry
`roots.txt` — #195); stage `check`/gate `run` commands are never
absolutized and `hooks/` is never staged (#196); one logical run
produces multiple jobs, reports, logs, and folder dialects
(`stages/`, `units/`, `messages/`+`sandboxes/`) that the maintainer
rejected as untraceable. The reuse benefits are real (child runners
worked with zero changes; job-granular supervision; on-disk
re-nursing) and are preserved below as narrow interfaces.

## Decision

One job per spur run; every stage is a **station** (any topology);
per-topology **engines** are hosted IN-PROCESS at each station behind
a narrow contract (station folder + shared `data/` shelf + scoped rail
verbs; never a sibling, never the root). Uniform run tree:

```
run/
├── workflow.toml roots.txt project.json hooks/   (faithful copy)
├── data/                        (shared shelf + final products)
├── stations/<S>/{briefs/<mind>.md, work/<mind>/,
│                 messages/, relay.json, protocol.json, verdict.txt}
├── table.json report.json orchestrator.log wake.json
└── delegations/<name>.json      (real cross-program commissions only)
```

Placement law, hosting contract, and the per-topology file table are
pinned in the zen and the PRD page; migration is four slices (coworker
in-process; lab in-process; faithful copy + command resolution; kill
the `wakes/<stage>` accept-hop), each green by mock rehearsal plus the
composite case.

## Consequences

- The mint and the per-stage child job die; #195/#196 close as a
  class. Delegation remains for genuinely separate programs only.
- Engines pay a coupling price: two loops' bookkeeping (courts,
  ledgers, drain) coexist in one job, keyed by station.
- Pause/continue drains to station boundaries; the window shows one
  job with station rows; the trace carries station-keyed cards.
- The mailbox/send-tool/ledger and question-bank designs (zen 7) ride
  the same tree.
