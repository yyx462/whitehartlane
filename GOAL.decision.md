# GOAL.decision

Dated branches from GOAL.md. Each names the rule it serves and what it
rejected. One entry per phase milestone.

2026-10-08 — The jev tuner, and a gray zone that asks. The permission
decider's flat "deny-unneeded" turned away work the job actually
needed (a vista job blocked off its own session shots) — the gray zone
(in home, outside roots, not dangerous) was a judgment wearing a
rule's clothes. Now that branch asks a real typed judgment:
`tunedPermissionJudge` sends the ask plus the member's brief through
the jev CLI with a landed prompt; below the landed threshold it stays
deny-with-guidance — and, merged with master's escalation, a repeat
ask for the same non-dangerous path still escalates to a durable
allow: the judge answers the first ask, escalateOnRepeat covers its
misses; a dead jev fails restrictive; secrets and credential-shaped
paths (added: `~/.config/jev/`, `~/.secrets/`, gpg) are denied before
the judge ever sees them. The prompt a gate asks
with is now data, not code: every JEV-involved gate (permission-
needed, grill-enough, workflow-choice) has a folder in
`jev-tuner/gates/` holding >= 50 LLM-seeded test cases, prompt
candidates, accuracy reports, and a winner record; `bin/jev-tuner
run` scores candidates through the same adapter and state builder the
rails use, sweeps noul thresholds offline, and the accuracy winner
lands in production (`src/jev-prompts/<gate>.*`) automatically when
it beats the incumbent by the gate's margin — tuning is never
hand-copying. Hand-tuned prompts and judged-by-vibes rewrites
rejected: the winner is measured or it does not land. Serves 2, 3.
Trail: src/permission.ts, src/jev.ts, src/jev-prompts.ts,
src/jev-tuner.ts, bin/jev-tuner, bin/pick-workflow, src/grill.ts,
bin/lab-orchestrator, jev-tuner/, test/jev-tuner.test.ts,
docs/RAILS.md, jev-tuner/README.md. Current winners: permission-
needed v4-named-and-safe 98.3% (t=0.6), grill-enough v2-criteria
100% (t=0.3), workflow-choice v1-baseline 98.1%.

2026-10-07 — Dag identity: the Project pid, the dag_id, the version
hash. Runs group like Airflow's DAG runs, so a group key was needed
that no path and no git provides. A Project is a pid minted once into
`project.json` inside the program folder (indexed on the OS disk):
worktrees and clones copy the file — runs combine silently, no
warning; a moved folder keeps its identity (paths are never identity);
git is never required (repo+branch rejected: not every project uses
git; absolute path rejected: it breaks on move and double-counts
worktrees). dag_id is explicit in workflow.toml, else the workflow
name, else a hashed id with a loud warning — it always exists and
grouping never silently falls apart. Duplicate protection is light
and never a refusal: the same (project, dag_id) with different
content from a different path warns. Every Job books the dag identity
— project, dag_id, source content hash (the version), source path,
and branch/worktree as labels that display but never identify. The
run door prints `dag: <pid>/<dag_id> version <hash>` and the
warnings. Programs may now live in any repo, not only
agentic-program; the OS disk is the one storage. Serves 5, 6. Trail:
src/project.ts, test/project.test.ts, CONTEXT.md (Project, Dag id).

2026-10-07 — The permission half of JEV, and members held idle. A
blocked worker's dialog used to wait for a person (the ui-window run
stuck on one for the job's own OS-disk paths). Now a dialog is a
question to a typed decider (`src/permission.ts` — a script, not an
agent): allow inside the member's roots (the root is also made durable
in the sandbox permissions), deny dangerous patterns (secrets,
outside-home) and deny unneeded wandering, each verdict injected as a
message and booked as a `permission` event; asks are capped (6, then
the member is dead). Worker permissions go back to restrictive by
default — the decider, not a human, is the throughput. Same run
taught the relay's wake discipline: exactly one member `initiates`
(wakes on its brief); every other member is born idle and held, and
its first prompt is brief + first message together, split by a -----
line — no context-read turn, no polling, no sleep loop; the rail is
the watcher. And mail is never delivered mid-turn: a working member
takes its message on a later beat, delivered only when the prompt
lands. Serves 2, 3, 4. Trail: docs/prd/coworker.md,
src/permission.ts, test/permission.test.ts.

2026-10-07 — Born booked; fork; coworker. JEV's gate half is retired:
nothing in the rail needs a model's yes to birth a pane — the lab path
already births from the professor's protocol and `src/policy.ts`
admits deterministically (slots, retry cap, one Job). What stands is
the stamp: every pane is born booked, `pane.born` carries the decider
(`parent`, zen 4's wake budgets), and a fork adds `seed ->
{tool, session_id, since}` — a pointer into an existing host session;
bytes never copied, the original never written, fresh record and
binding; a fork passes the same admission plus the seed must resolve.
Adoption of a live pane of another session stays rejected: its record,
scope, and binding answer to another master, and the receipt (panes of
this Job = 0) goes ambiguous. Ownership reworded: the trace owns pane
records — shep and herdr are mechanisms, not owners. And panes may now
depend on each other, in a third workflow kind: Coworker — named
members exchange typed message files on the Job dir, the Rail is the
relay (a worker never writes another worker), the orchestrator pane
stays optional and failure-only, and the Job still produces a report
(`kind = "coworker"`). The chat's product half is becoming a DAG
creator; the shell stays. Supersedes: zen 1's "JEV is the only birth
canal" (the stamp survives), Ownership's shep line. Serves 1, 2, 4, 5.
Trail: docs/zen/2026-10-07-zen-6.md, docs/prd/coworker.md.

2026-10-07 — No first-tenant favors. The rail read SKILL_RSI_TARGET and
SKILL_RSI_PROTOTYPE_ROOT — the first program's shell plumbing baked
into the OS, four lines of special case. Gone: a program names the
extra roots its workers may touch in `roots.txt` (one absolute path
per line, staged beside the dag like task.txt), and the actor brief
carries no OS-injected Target line — the program's own actor.md and
task.txt say where its world lives. A program is data files and hook
commands, never env-var names the rail knows. skill-rsi is now an
ordinary tenant and the copyable template. Serves 3, 6.

2026-10-06 — Detectors and gates: the program owns the photograph's
source, the OS owns tick. What a wave is, what an end is, and what a
gate waits on are hook knowledge (`[detectors]` signal/end, `[gates]`
in workflow.toml; a `gate` verb in dag.mjs) — they were rail-hardcoded
(protocol.json, log.txt), which rule 3 could not allow forever. A
detector may slow the rail (exit 75 = refusal, retried), never kill
it; pane liveness stays rail-owned: a dead pane is dead even under a
custom end detector. The run door refuses a gate step with no matching
[gates] command, and a program names one step per singleton verb.
A program may carry a data/ folder; the door stages it beside the dag
— a program is data files and hook commands, nothing else. Rejected:
program-supplied tick — a second scheduler per program; the rail could
no longer promise one reopen rule, one retry cap, one receipt, and a
dead orchestrator could not be relaunched into a loop it does not own.
Airflow never let a DAG ship a scheduler; its sensors are the pluggable
part. Serves 3, 6. Trail: docs/adr/0003-detectors-and-gates.md,
examples/agentic-program/ (trivia-bench, inbox-zero, two-signoffs).

2026-10-03 — One start door, and unattended is a first-class path.
`agentic-os run <folder>` reads `workflow.toml`, books a fan-out Job,
and starts the engine. No grill. No question. A second running Job on
that session is refused. The chat still stands a Job up itself; it must
call `run` (not built). A window may list folders and Jobs, and its
button calls `run`. It is not a second OS (not built). A project does
not draw a graph: that would be a second scheduler. LangChain is a
library. LangGraph is the wheel we are not rebuilding. A program lives
outside this repo. It stands a Job up. The rails make that Job
manageable. The program does not rewrite them. This repo does not
import it. The typed command is `agentic-os run`. The
manifest stays toml, not a Python file. A Job on this path can finish
with no person in the loop. A dead orchestrator still waits. Promote
is never part of the Job. Serves 1, 3, 4, 5.

2026-10-01 — Prep reads the compacted view. The planner gets
context.md: the latest compaction summary plus what was kept, and
failed units from the trace. Text the summary replaced is not handed
over. Promote is a gate, not a push: `agentic-os promote <jid>` prints
findings and stops, or calls `gwt submit-pr` and records job.promoted.
It never merges. A clean receipt is not permission; the human runs the
command. Serves 2, 3, 5.

2026-10-01 — Phase C workflow, promote parked. A First Mate session is
one OS session bound to one host id. Compact does not mint a new id.
`/new` is a new First Mate session; it does not join the old task.
Worker agent ids stay on pane events. Jev answers one question before
a Job exists: enough to write hooks and run? Not enough stays in the
chat. "just do it" skips; "grill me" forces the questions. The first
admitted fan-out in a gwt project spawns one worktree and points the
session at it. Workers edit that tree; briefs, logs, and result.md
stay on the OS run dir. Canary is automatic: unit 1, jev inside the
grade hook. Pass scales with no typing. Fail retires the Job
canary-stopped and tells the First Mate. A retry is a new Job on the
same session. One running Job per session. Promote waits: gwt may
open a PR later, and it never merges. Serves 1, 2, 3.

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
