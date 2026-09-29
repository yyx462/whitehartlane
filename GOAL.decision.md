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

2026-09-29 — Zen 1: the gate is pane birth, not task entry. The First
Mate (the pi chat) is a shell, not a kernel — it talks, plans, and
edits freely; a session may exist with no Job. A pane exists only
through JEV: the model proposes, policy admits. The first admitted
spawn on a session creates the Job, then the pane. The user answers a
pane in the pane; First Mate gets a one-line wake only. One worktree
per session, shared by the Job's panes. Supersedes: "every task enters
one gate", the always-intercept prompt gate, worktree-per-task,
answers-in-First-Mate. Survives: rails/hooks, disposability, silence,
retired-to-zero. Serves 1, 2, 4. Rejected: the Linux framing, every
prompt a process, two writers on one tree. Enforcement gap, open until
the admission work lands: First Mate's bash could call shep spawn
directly — the admission tool must be the only door the rails honor.
Trail: docs/zen/2026-09-29-zen-1.md.

2026-09-29 — not LangGraph, not Temporal. Their workers are calls or
activities; ours are terminals a human watches. Keep the surface thin
and ours. Serves all. Rejected: framework adoption.

2026-09-29 — plan layer. Stages over the workflow catalog; hooks
generated per task from grill context; canary before scale. Serves 1, 3.
Open debts, tracked here until closed: real backpressure (provider
signal, not slots), orchestrator-death relaunch.
