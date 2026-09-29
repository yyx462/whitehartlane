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

2026-09-29 — Zen 2: state splits, First Mate is not disposable. Workers
are panes plus a relaunchable orchestrator; the shell is not a worker.
OS disk is sessions/<sid>/ (trace, state, ledger, pane records); project
bytes stay in a bound worktree in the target repo — a binding, never a
copy. A pane's context is scratch. Retired is a Job state, not deletion;
reopen on the same tree. Supersedes: "task directory" as one store,
worktree-per-edit. Serves 2. Trail: docs/zen/2026-09-29-zen-2-5.md.

2026-09-29 — Zen 3: the rails inventory is deferred. The core holds —
rails do not change per Job, hooks do, a planner writes hooks and never
rails — but which components are rails gets listed from use, not from
the blog's nouns. Serves 3.

2026-09-29 — Zen 4: two parents, two attention budgets. The global
"failures wake, successes stay silent" was wrong about the shell: First
Mate's direct panes (grill, summary) may report done. Orchestrator
fan-out stays silent on success; failures and stuck wake the
orchestrator. A Job may wake First Mate once at the end. JEV stamps
parent: first_mate | orchestrator. Supersedes: the global silence rule
(and zen 1's survival note about it). Serves 4.

2026-09-29 — Zen 5: the receipt is per-Job panes, not scorched earth.
A Job ends when its panes reach 0; session, worktree binding, and Job
record remain so the work can reopen. Deleting a tree or merging to
master is a separate command, never retire. Supersedes: retired-to-zero
as everything-gone. Serves 5.

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
