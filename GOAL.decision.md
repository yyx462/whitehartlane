# GOAL.decision

Dated branches from GOAL.md. Each names the rule it serves and what it
rejected. One entry per phase milestone.

2026-09-29 — pane is the process. Agent CLI in a herdr pane = process:
own context, disposable, visible. Serves 2. Rejected: in-process
subagents (invisible, one runtime).

2026-09-29 — ownership splits. shep ledger owns panes; the task
directory owns progress and output. Serves 2. Rejected: one store.

2026-09-29 — labels are run-scoped. Pane labels carry a run id after
the collision incident stranded fleets. Serves 5. Rejected: global
names, manual cleanup.

2026-09-29 — not LangGraph, not Temporal. Their workers are calls or
activities; ours are terminals a human watches. Keep the surface thin
and ours. Serves all. Rejected: framework adoption.

2026-09-29 — plan layer. Stages over the workflow catalog; hooks
generated per task from grill context; canary before scale. Serves 1, 3.
Open debts, tracked here until closed: real backpressure (provider
signal, not slots), orchestrator-death relaunch.
