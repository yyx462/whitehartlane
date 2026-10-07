# Agentic OS

A shell and supervisor for subagent work. The user talks in the First Mate; every pane is born booked.

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
A component that receives an input and has an orchestrator. The index is `workflow.toml`: it names the hook commands. It is not the loop. Fan-out and Coworker must produce a report. Direct must not finish. A project fills hooks. A project does not skip the report, and it does not draw a graph.
_Avoid_: hierarchy, fleet, driver, custom script, DAG file, program

**Scheduler**:
The part that picks a workflow for a task. It does not run the task and it does not elect a leader.
_Avoid_: orchestrator, driver, jev, program

**Jev**:
The birth check and the stamp. Policy admits — deterministic checks: slots, the retry cap, one Job, and, for a fork, a seed that resolves. `pane.born` books the decider as `parent`. A model may propose; its proposal is an input to booking, never the booking. Cheap typed judgment, not an agent and not a pane.
_Avoid_: birth canal, gate, router model, LLM scheduler, subagent

**Fork**:
A birth mode. The new pane's host session starts seeded from a pointer into an existing host session: `seed = {tool, session_id, since}`. The bytes are never copied and the original session is never written. A fork passes the same admission as any birth — plus the seed must resolve — and it is booked on `pane.born`.
Example: the lender pane in a Coworker Job, forked from three hours of the old project's session.
_Avoid_: adopt, enlist, takeover, session copy, polluting the original

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
The live pane that watches the pane ledger. It knows its name. It wakes when a pane is blocked. It does not write a Protocol, and it does not call shep.
_Avoid_: actor, babysitter, operator, front door, shepherd, worker

**Actor**:
The live pane that holds the Host session. It looks at the skill, writes prototypes, and writes the Protocol. It does not call shep.
_Avoid_: orchestrator, mock, worker

**Mock**:
A named worker pane that runs the skill and writes what the skill generates. It is not the Actor and not the Orchestrator.
_Avoid_: test, prototype, scenario pane

**Protocol**:
The file the Actor writes on the Job dir to name the next Wave of Mocks. The Rail reads it. The Orchestrator does not write it.
_Avoid_: brief, DAG, queue, prompt

**Wave**:
The Mock panes one Protocol births. The Rail waits until every pane in it has an End. A blocked pane wakes the Orchestrator.
_Avoid_: iteration, job, chunk, fleet, pass

**End**:
A named finish of one pane. herdr names some. The Rail may add a name. It is not one word for every failure.
_Avoid_: stuck, status, error

**Fan-out**:
The workflow for independent units. Workers do not depend on each other. The orchestrator starts them and settles results.
_Avoid_: fleet, hierarchy, swarm

**Coworker**:
The workflow for panes that depend on each other. Named members exchange typed message files on the Job dir; the Rail is the relay — it moves a message to the named pane's prompt. A worker never writes another worker. `kind = "coworker"` in `workflow.toml`. It must produce a report.
_Avoid_: social group, chat room, swarm, orchestrator-with-friends

**Direct**:
The workflow for one worker. That worker is the chat the user already has open. No pane is opened. No retry: the open chat is the supervisor — a blocked turn is visible and the user resends; unattended work belongs to a Job, not Direct. There is no finish and no report.
_Avoid_: single agent, dummy workflow, fallback, hidden retry script

**Rail**:
Machinery every workflow uses and none may rewrite: pane ledger, fail recovery, backpressure, and the retry cap. Not the orchestrator's method. Not the layout.
_Avoid_: watcher, operator, script

**Hook**:
The task-specific part a project fills in: what one unit of work is, the worker brief, how to grade, where artifacts go, which counts the report shows, and — as detectors — what a wave, an end, or a gate looks like in the world. Each is a command string in `workflow.toml`. Any language. A `hooks/` folder beside the toml is a copy convention, not the contract.
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
A recorded fact that one object is the parent of a worker or of an artifact. Three owners, and they do not overlap. The trace owns pane records. The Job's dir owns progress and output. The worktree owns project bytes. shep and herdr are mechanisms, not owners. A worker owns none of these.
Example: `w-france` dies on the trace's pane record. `report.json` lives in the Job dir. The repo the worker edits is the worktree.
_Avoid_: leader, lease, "I spawned it", task directory, the shep ledger owns panes

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
