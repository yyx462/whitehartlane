# Agentic OS

A shell and supervisor for subagent work. The user talks in the First Mate; panes are born only through JEV.

## Language

**First Mate**:
The pi chat the user works in — the shell. It talks, plans, and may propose panes. It is not itself a pane, and it never takes a pane's answer.
_Avoid_: front door, orchestrator, scheduler, kernel

**Session**:
The OS record on disk at `sessions/<sid>/`: events, jobs, pane records, and a binding. One per key. A First Mate chat is keyed by `(tool, host session id)`. A CLI start is keyed by `(agentic-os, folder path)`. May have no Job.
Example: `s-a1b2` holds `events.jsonl` and `jobs/`.
_Avoid_: host session, pi chat, opencode `ses_…`, task, chat history, folder

**Host session**:
The agent's own conversation, owned by pi or opencode. A Session stores a pointer to it (`tool`, `session_id`, `session_file`). The bytes are never copied.
Example: pi's session file, or opencode `ses_01abc`.
_Avoid_: Session, OS session, transcript

**Binding**:
The session's record of repo and worktree path. Project bytes live in the target repo's worktree, never as an OS copy. Confirmed once per session and echoed in every report; a worktree already bound to a live session is refused — never two writers on one tree. `gwt spawn` creates it inside the target repo. If that folder is later gone, the next job on the same session spawns a new one from master. The trace stays.
_Avoid_: snapshot, copy

**Job**:
The managed group of panes on a session, with state and policy. Created by the first admitted spawn; `retired` is a state, not deletion. No Job, no panes. A Job started by `agentic-os run` can finish with no person in the loop. A quiet success is not a wake. A dead orchestrator waits for a person. Promote is never part of the Job.
_Avoid_: fleet, run, campaign, host session, program

**Unattended**:
A Job path with no person in the loop. `agentic-os run` is that path. Direct is not. A dead orchestrator and promote still wait for a person, and neither is the happy path.
_Avoid_: direct, grill, promote

**Program**:
Code outside this repo. It stands a Job up. The rails make that Job manageable. The program does not rewrite them. This repo does not import it. The typed command is `agentic-os run`.
Example: skill-rsi.
_Avoid_: workflow, Job, scheduler, pipeline, project

**Workflow**:
A component that receives an input and has an orchestrator. The index is `workflow.toml`: it names the hook commands. It is not the loop. Fan-out must produce a report. Direct must not finish. A project fills hooks. A project does not skip fan-out's report, and it does not draw a graph.
_Avoid_: hierarchy, fleet, driver, custom script, DAG file, program

**Scheduler**:
The part that picks a workflow for a task. It does not run the task and it does not elect a leader.
_Avoid_: orchestrator, driver, jev, program

**Jev**:
The birth canal. The model proposes a pane; policy admits it. That pair is JEV. Cheap typed judgment, not an agent and not a pane.
_Avoid_: router model, LLM scheduler, subagent

**Trace**:
The append-only `events.jsonl` on a session disk: every route, admission, pane birth and death, settle, retire, abort, wake. The single source; all records are projections of it.
_Avoid_: log, history, audit log

**Transcript**:
A worker's conversation bytes, owned by its host tool (pi jsonl, opencode db). Recorded as a pointer `{tool, cwd, since}` in the pane event — never copied.
_Avoid_: copy, mirror

**Resolver**:
The per-tool adapter that turns a transcript pointer into readable bytes: pi → the pinned file; opencode → `opencode export`.
_Avoid_: parser, converter

**Pane**:
A herdr split the workflow's workers run in. `shep` opens and closes these. `shep` is not this product.
_Avoid_: worker, subagent

**Worker**:
An opencode or pi agent running in a pane. It does a unit of work. It does not own the rails.
_Avoid_: orchestrator, subagent, pane, front door

**Orchestrator**:
The part of a workflow that makes sure the output exists. It may be an agent, a script, or jev. That choice belongs to the workflow. It may retry only up to a hard cap.
_Avoid_: front door, shepherd, worker

**Fan-out**:
The workflow for independent units. Workers do not depend on each other. The orchestrator starts them and settles results.
_Avoid_: fleet, hierarchy, swarm

**Direct**:
The workflow for one worker. That worker is the chat the user already has open. No pane is opened. No retry: the open chat is the supervisor — a blocked turn is visible and the user resends; unattended work belongs to a Job, not Direct. There is no finish and no report.
_Avoid_: single agent, dummy workflow, fallback, hidden retry script

**Rail**:
Machinery every workflow uses and none may rewrite: pane ledger, fail recovery, backpressure, and the retry cap. Not the orchestrator's method. Not the layout.
_Avoid_: watcher, operator, script

**Hook**:
The task-specific part a project fills in: what one unit of work is, the worker brief, how to grade, where artifacts go, and which counts the report shows. Each is a command string in `workflow.toml`. Any language. A `hooks/` folder beside the toml is a copy convention, not the contract.
_Avoid_: workflow, rail, operator

**Report**:
The readable finish fan-out must produce. A `report.json` with a status, named counts, a table, and where to check. First Mate shows it. Direct does not produce one.
Example: `{"status":"done","counts":{"lookups":3}}`.
Not a report: the trace, the orchestrator log, a wake, the receipt, a pane's answer.
_Avoid_: log, trace, receipt, wake, dashboard

**Outliving memory**:
State that remains after the worker that wrote it is gone, so another worker can resume. Not the context window.
_Avoid_: snapshot, context, chat history

**Ownership**:
A recorded fact that one object is the parent of a worker or of an artifact. Three owners, and they do not overlap. The `shep` ledger owns panes. The Job's dir owns progress and output. The worktree owns project bytes. A worker owns none of these.
Example: `w-france` dies on the shep ledger. `report.json` lives in the Job dir. The repo the worker edits is the worktree.
_Avoid_: leader, lease, "I spawned it", task directory

**Backpressure**:
The workflow stopping new provider calls when the provider refuses or slows, then opening them again when the provider can take more. A hand-set cap is not this.
_Avoid_: concurrency limit, CONC, admission

**Leader**:
The single member a workflow allows to append a shared log, only while the others still accept it. Optional. Not system-wide.
_Avoid_: owner, orchestrator, front door

**Layout**:
How a workflow shows its panes. It belongs to that workflow. Fan-out gets its own tab: the orchestrator lane is one full-height pane on its side, and the worker column (configurable cap, default 2) takes the rest, split to equal heights. Direct opens no pane.
_Avoid_: dashboard, one layout for every workflow

**Task directory**:
Superseded by zen 2. One folder used to hold both OS state and project bytes. Those split: OS state lives at `sessions/<sid>/`; project bytes live in the bound worktree. The name stays so it is not revived.
_Avoid_: use Session and Binding

**Wake**:
A pane's claim on a parent's attention. First Mate's direct panes may report done; orchestrator workers wake only on failure or stuck; a Job may wake First Mate once at the end.
_Avoid_: notification, ping

**Receipt**:
The Job's finish line: panes of that Job remaining = 0. Session, binding, and Job record remain. Merge and delete are separate commands.
_Avoid_: cleanup done, scorched earth
