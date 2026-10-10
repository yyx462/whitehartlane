# Agentic OS

A shell and supervisor for subagent work. The user talks to a levy; every pane is born booked.

## Language

**Levy**:
Any main agent that levies a spur — plans the work, chooses the workflow, calls `whl run --from <tool>:<session-id>`, carries on, and receives exactly one wake at the end. A position relative to a spur, not a privileged entry: the skill (`yyx-whl`) gives every agent the context to hold it, and a levy may itself be a worker of another spur (spurs may nest; the wake goes to the pointer regardless). It does not babysit what it levied, and it never takes a pane's answer.
_Avoid_: front door, orchestrator, scheduler, kernel, first mate (the old entry-only word; `first_mate` survives only as a legacy wire value)

**Session**:
The OS record on disk at `sessions/<sid>/`: events, jobs, pane records, and a binding. One per key. A levy chat is keyed by `(tool, host session id)`. A CLI start is keyed by `(agentic-os, folder path)`. May have no Job.
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
A Job path with no person in the loop. `agentic-os run --unattended` is that path — explicit on the door, because a Job nobody hears finishing is an information gap; the default books a levy and wakes it once. Direct is not that path. A dead orchestrator and promote still wait for a person, and neither is the happy path.
_Avoid_: direct, grill, promote

**Program**:
Code outside this repo. It stands a Job up. The rails make that Job manageable. The program does not rewrite them. This repo does not import it. The typed command is `agentic-os run`.
Example: skill-rsi.
_Avoid_: workflow, Job, scheduler, pipeline, project

**Project**:
The namespace a spur id is unique in. A pid minted once, kept in `project.json` inside the program folder and indexed on the OS disk. Worktrees and clones copy the file, so runs combine under one group wherever the folder lives — no warning, by design. Paths are never identity; move the folder, the trace continues. Git is never required.
_Avoid_: repo, worktree, folder path, git origin

**Spur id**:
The group runs gather under, unique inside its Project — a branch line off the main track: it stands up, runs to completion, and reports back while the main session carries on. Explicit `dag_id` in `workflow.toml`; else the workflow name; else a hashed id with a loud warning — it always exists. Each Job records the spur identity: project, the id, the source content hash (the version), the source path, and labels (branch, worktree) that display but never identify. The word is `spur` everywhere a human reads; `dag`/`dag_id` remain the historical key spelling on disk, in `workflow.toml`, and on the API — a format, never the word.
_Avoid_: workflow name collision, run id, Job id, tag, dag, loop

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
Example: the lender pane in a Coworker Job, forked from three hours of the old project's session; `whl fork <jid>`, the levy-side use — a booked wake delivered into a reborn levy pane.
_Avoid_: adopt, enlist, takeover, session copy, polluting the original

**Trace**:
The append-only `events.jsonl` on a session disk: every route, admission, pane birth and death, finish, retire, abort, wake. The single source; all records are projections of it.
_Avoid_: log, history, audit log

**Transcript**:
A worker's conversation bytes, owned by its host tool (pi jsonl, opencode db). Recorded as a pointer `{tool, cwd, since, session_id}` in the pane event — never copied. The `session_id` is booked at birth, before work starts: it is the handle a Continue resumes.
_Avoid_: copy, mirror

**Resolver**:
The per-tool adapter that turns a transcript pointer into readable bytes: pi → the pinned file; opencode → `opencode export`.
_Avoid_: parser, converter

**Pane**:
A herdr split an agent runs in, of two kinds: a worker pane is born booked (a rail asked herdr to open it for a Job, it dies with the Job); a levy pane is self-registered (`whl register` from inside it — the levy's own chat, renewed by presence). Both are admitted by the ledger; herdr owns the tty either way.
_Avoid_: worker, subagent

**Worker**:
An opencode or pi agent running in a pane. It does a unit of work. It does not own the rails.
_Avoid_: orchestrator, subagent, pane, front door

**Orchestrator**:
The deterministic engine that runs a workflow's loop — the `Rail` plus the workflow's runner (fan-out, lab, coworker). A detached process, never a pane and never an agent: runtime judgment sits in typed gates (jev) or in consumed protocols (the actor's `Protocol`). A workflow earns a mind only when a runtime judgment is needed that no typed gate can hold AND its output has a consumed channel — no workflow passes today.
_Avoid_: mind, agent, actor, babysitter, operator, front door, shepherd, worker

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

**Finish**:
The umbrella over a step's final state — reached when its signal lands, whatever the color. Writes state.json (done ∪ failed), one `unit.finished` event, one report row. The lattice: finish is the umbrella; done/failed are the tracks. `done` alone is a worker's claim — the grade decides the color.
_Avoid_: settle (retired), complete, resolve, close

**finished_by**:
The manifest field typing a step by the signal that finishes it: `end` (a worker's log line), `check` (a command exits 0 — stdout ignored), `wake` (a child Job's receipt). ADR 0007.
_Avoid_: settles (retired), returns, output, does

**Check step**:
A step where nothing works: a command is asked, exit 0 finishes it, nonzero means not-yet (re-asked on the gate debounce). Different contract from `[gates]` report detectors, which print `done` (ADR 0003).
_Avoid_: gate (ambiguous), poll, sensor

**Unreachable**:
A check whose earlier waves hold a failure — it can never be asked, so it cannot count against the run finishing. Terminal by rule; the run finishes honestly failed instead of waiting forever.
_Avoid_: deadlock, skipped (different concept)

**Football reading**:
The onboarding layer, not the canonical words: levy = the chairman (commissions the fixture, walks away, gets the full-time call); Job = a fixture at the Lane; worker = a player playing a position; brief = the manager's team talk; rail = the manager on the touchline (never leaves); wave = a wave of attack; check = a VAR check; wake = the result elsewhere; `done` = the shot; grade = does the goal stand; finish = full-time; pause/continue = half-time / the abandoned match resumed from the booked minute; deadline = stoppage time; blocked = an injury; report = the match report. Where football has no word (signal, slot, spawn, retire, arm), plain English wins — a faked metaphor word breaks the dictionary worse than an honest plain one.
_Avoid_: extending the metaphor into the machinery

**Fan-out**:
The workflow for independent units. Workers do not depend on each other. The orchestrator starts them and finishes results.
_Avoid_: fleet, hierarchy, swarm

**Coworker**:
The workflow for panes that depend on each other. Named members exchange typed message files on the Job dir; the Rail is the relay — it moves a message to the named pane's prompt. A worker never writes another worker. `kind = "coworker"` in `workflow.toml`. It must produce a report.
_Avoid_: social group, chat room, swarm, orchestrator-with-friends

**Direct**:
The workflow for one worker. That worker is the chat the user already has open. No pane is opened. No retry: the open chat is the supervisor — a blocked turn is visible and the user resends; unattended work belongs to a Job, not Direct. There is no finish and no report.
_Avoid_: single agent, dummy workflow, fallback, hidden retry script

**Rail**:
Machinery every workflow uses and none may rewrite: pane ledger, fail recovery, backpressure, the retry cap, and privilege control (the permission sweep). One implementation: the `Rail` in `src/rail.ts` — the bins are thin entries. Not the orchestrator's method. Not the layout.
_Avoid_: watcher, operator, script

**Hook**:
The task-specific part a project fills in: what one unit of work is, the worker brief, how to grade, where artifacts go, which counts the report shows, and — as detectors — what a wave, an end, or a gate looks like in the world. Each is a command string in `workflow.toml`. Any language. A `hooks/` folder beside the toml is a copy convention, not the contract.
_Avoid_: workflow, rail, operator

**Report**:
The readable finish fan-out must produce. A `report.json` with a status, named counts, a table, and where to check. The levy reads it. Direct does not produce one.
Example: `{"status":"done","counts":{"lookups":3}}`.
Not a report: the trace, the orchestrator log, a wake, the receipt, a pane's answer.
_Avoid_: log, trace, receipt, wake, dashboard

**Outliving memory**:
State that remains after the worker that wrote it is gone, so another worker can resume. Not the context window.
_Avoid_: snapshot, context, chat history

**Resumable**:
A Job property: it can park — pause or abort — and a later Continue picks up from outliving memory, not from scratch. The pane records with their session pointers, the finish projection, and the mail make a Job resumable. The context window never does.
_Avoid_: statefulness, checkpointable, durable

**Pause**:
The graceful park: stop taking new work, drain in-flight work to its boundary, retire the panes, book `paused`. SIGTERM. Bounded by the drain ceiling — past it the straggler aborts, the wait never extends.
_Avoid_: suspend, freeze, hibernate

**Drain**:
The wait inside a Pause. In-flight work finishes to its boundary: a unit finishes in fan-out, a member ends its turn in Coworker. Pending mail is not drained; it waits. Not backpressure, not a concurrency cap.
_Avoid_: graceful shutdown, cooldown

**Abort**:
The immediate park: book `aborted` now, kill the panes now, keep every booked pointer. An unbooked death is an orphan; Continue treats both the same. Nothing auto-continues — a dead orchestrator waits for a person.
_Avoid_: force stop, destroy, kill -9

**Continue**:
The reborn verb: retire stragglers, respawn each pane of unfinished work with its host session resumed, prompt it "continue", restart the orchestrator. Accepts `paused`, `aborted`, and `orphaned` alike. Deliberate and human-typed, never automatic.
_Avoid_: relaunch, restart, auto-recover

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

**Booked wait**:
A pane's idle that a live child spur explains: the pane's booked session is the spawner of a running Job. Rails stand their stall and nudge clocks down while it holds; the run deadline still bounds. Clears when the child parks or retires — then the wake (or the stall) applies. Not a park, not a stall.
_Avoid_: keepalive, heartbeat, blocked, sleeping

**Wake**:
A pane's claim on a parent's attention. A levy's direct panes may report done; orchestrator workers wake only on failure or stuck; a Job may wake its levy once at the end, best-first (ADR 0008): a prompt into a live worker pane, a prompt into the levy's registered pane, the fork (an unregistered chat is dead to the ladder by rule — registration is the only aliveness claim that outranks it), the wake spool (opt-in plugin, herdr-less hosts), then the doorbell; the durable wake.json waits regardless. A rail levy (ADR 0007 wake steps) is a process, not a conversation: no prompt, no fork, no spool, no doorbell — the wake.json is the receipt the parent polls.
_Avoid_: notification, ping

**Receipt**:
The Job's finish line: panes of that Job remaining = 0. Session, binding, and Job record remain. Merge and delete are separate commands.
_Avoid_: cleanup done, scorched earth
