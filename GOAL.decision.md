# GOAL.decision

Dated branches from GOAL.md. Each names the rule it serves and what it
rejected. One entry per phase milestone.

2026-10-01 — Phase B.1: backpressure is real, relaunch is ask-first.
The provider's refusal is information, not failure: the planner hook
classifies (exit 75 = refused/slowed, anything else deterministic) and
the rail retries — refusal only, exponential backoff with jitter, cap
3, a visible line per wait (a silent backoff reads as a hang), a
backpressure trace event. A dead orchestrator parks its Job `orphaned`
in a derived ask-first queue: announced on the periodic check, never a
wake, never auto-resurrected (what the user killed stays killed;
graceful stops abort and never orphan). relaunch retires the dead
generation's stragglers first (two generations must not double-write
one unit dir), is capped at 2 tries, reconciles against events, and
counts this Job's panes for its receipt. pane.born now carries the JEV
parent stamp (first_mate | orchestrator). Direct has NO retry rail,
deleted from its promise: the open chat is the supervisor — a blocked
turn is visible, the user resends, unattended work belongs to a Job.
Supersedes: the hidden retry script in CONTEXT.md's Direct. Serves 2,
3, 4, 5. Inventory closed: docs/RAILS.md.

2026-10-01 — binding confirms once per session, echoed in every
report; a worktree already bound to a live session is refused (two
writers on one tree is a zen 1 do-not-resurrect). Decided now, built
in the project-binding era. Serves 1, 2.

2026-10-01 — slots is a hook, not a rail: the per-task tunable may
change per Job; the rail is that a cap exists and the ledger honors
it. Serves 3.

2026-09-29 — pane is the process. Agent CLI in a herdr pane = process:
own context, disposable, visible. Serves 2. Rejected: in-process
subagents (invisible, one runtime).

2026-09-29 — ownership splits. shep ledger owns panes; the task
directory owns progress and output. Serves 2. Rejected: one store.

2026-09-29 — labels are run-scoped. Pane labels carry a run id after
the collision incident stranded fleets. Serves 5. Rejected: global
names, manual cleanup.

2026-09-30 — Phase B: one home, one trace. The OS disk moved to
~/.local/share/agentic-os (data, not state — traces are for training,
not for disposal). Sessions bind to the host conversation keyed on
(tool, host session id) — find-or-create, so a resumed chat never
mints a duplicate; jobs reference the sid only (one hop to the host
path). events.jsonl is THE trace: route/admit/reject, pane.born with a
transcript pointer {tool, cwd, since}, unit.settled with the grade row,
job.retired/aborted, wake.consumed. job.json, report.json, state.json
are projections. Runs live at sessions/<sid>/jobs/<jid>/run/ with
per-unit dirs (brief/log/result) that double as worker cwds — which
makes both pi and opencode transcripts resolvable newest-for-cwd; the
resolver layer reads them (pi file; opencode export). <cwd>/.agentic-os
is dead; fresh start, nothing migrated. rows.jsonl died (grade rows
live in events). Zen 3 note: the event schema is the first rail
admitted from use. Serves 2, 3, 4, 5.

2026-09-30 — Phase A: the OS disk exists; Jobs are records now. The
front door opens a session per process, JEV admits or rejects before
any pane is born (policy.ts), and an admitted fan-out creates the Job
before the orchestrator spawns — the first admitted spawn makes the
Job. The orchestrator books every pane (born/died) and retires the Job
with a receipt: panes remaining 0. A bare orchestrator run self-opens
a standalone Job, so killed runs are sweepable: `agentic-os sweep`
marks dead-pid Jobs aborted; `agentic-os audit` flags live panes no
Job admits (the only door is JEV). Records are never deleted; the
tree stays bound, not copied. Enforced in shell, not in policy: a
determined shell can still call shep spawn — audit makes bastards
visible. npm test now runs under the scratch scope so test fleets
never land in a live scope. Serves 1, 2, 4, 5.

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
Open debts, tracked here until closed: ~~real backpressure (provider
signal, not slots)~~ closed 2026-10-01 (refusal-only retry at the
headless-call layer); ~~orchestrator-death relaunch~~ closed 2026-10-01
(ask-first relaunch queue, cap 2).
