# WhiteHartLane

A shell and supervisor for subagent work. The user talks to a levy; every pane is born booked.

## Language

**Levy**:
Any main agent that levies a spur — plans the work, chooses the workflow, calls `whl run --from <tool>:<session-id>`, carries on, and receives exactly one wake at the end. A position relative to a spur, not a privileged entry: the skill (`yyx-whl`) gives every agent the context to hold it, and a levy may itself be a worker of another spur (spurs may nest; the wake goes to the pointer regardless). It does not babysit what it levied, and it never takes a pane's answer.
_Avoid_: front door, orchestrator, scheduler, kernel, first mate (the old entry-only word; `first_mate` survives only as a legacy wire value)

**Session**:
The OS record on disk at `sessions/<sid>/`: events, jobs, pane records, and a binding. One per key. A levy chat is keyed by `(tool, host session id)`. A CLI start is keyed by `(whitehartlane, folder path)`. May have no Job.
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
The managed group of panes on a session, with state and policy. Created by the first admitted spawn; `retired` is a state, not deletion. No Job, no panes. A Job started by `whitehartlane run` can finish with no person in the loop. A quiet success is not a wake. A dead orchestrator waits for a person. Promote is never part of the Job.
_Avoid_: fleet, run, campaign, host session, program

**Unattended**:
A Job path with no person in the loop. `whitehartlane run --unattended` is that path — explicit on the door, because a Job nobody hears finishing is an information gap; the default books a levy and wakes it once. Direct is not that path. A dead orchestrator and promote still wait for a person, and neither is the happy path.
_Avoid_: direct, grill, promote

**Program**:
Code outside this repo. It stands a Job up. The rails make that Job manageable. The program does not rewrite them. This repo does not import it. The typed command is `whitehartlane run`.
Example: skill-rsi.
_Avoid_: workflow, Job, scheduler, pipeline, project

**Project**:
The namespace a spur id is unique in. A pid minted once, kept in `project.json` inside the program folder and indexed on the OS disk. Worktrees and clones copy the file, so runs combine under one group wherever the folder lives — no warning, by design. Paths are never identity; move the folder, the trace continues. Git is never required.
_Avoid_: repo, worktree, folder path, git origin

**Spur id**:
The group runs gather under, unique inside its Project — a branch line off the main track: it stands up, runs to completion, and reports back while the main session carries on. Explicit `spur_id` in `workflow.toml`; else the workflow name; else a hashed id with a loud warning — it always exists. Each Job records the spur identity: project, the id, the source content hash (the version), the source path, and labels (branch, worktree) that display but never identify. The word AND the format are `spur` (`spur.mjs`, `spur_id`, ADR 0009); legacy `dag`/`dag_id` remain readable on disk and in old manifests — a format of the past, never written new.
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
RETIRED (ADR 0014) — the field that typed a step by the signal that finished it: `end` (a worker's log line), `check` (a command exits 0), `wake` (a child Job's receipt). The `[[stage]]` dialect carries its cases in topology: unit stages finish on the worker's word, coworker/lab at the station, gate on its one-shot `run`.
_Avoid_: settles (retired), returns, output, does

**Check step**:
RETIRED as an authoring shape (ADR 0014) — a step where nothing works, polled until exit 0. Its two heirs: a stage `check` (judge — fires with its workforce alive) and a gate `run` (act — one-shot, at the frontier).
_Avoid_: gate (ambiguous), poll, sensor

**Stop ceremony**:
How an exchange ends (run #17's law): a member's stop is accepted only when NOBODY is working (the drain rule — one spelling, never a fixed sleep), then the stage check runs while every pane still lives: red is ONE revise round at the stop's author carrying the check's stderr verbatim; a second red fails honestly. A station settles done only through its check — the receipt row proves it ran.
_Avoid_: audit-after-retire, post-exchange check, settle window, quiet period

**Proof gate**:
The pr-review rail's decision model (`whl review`, template `templates/pr-review/`): a finding blocks a merge ONLY with a repro test that fails on an assertion on HEAD twice and classifies against BASE — `introduced` (fails HEAD, passes BASE) or `incomplete-fix` (fails both, the diff touches the finding's file) block; `pre-existing`, `bogus`, `flaky`, `refuted`, unproven and P2/P3 are advisory and never block. A fact blocks; an opinion never does.
_Avoid_: LLM judge, severity vote, confidence score

**Responsibility divider**:
The review's reject path: one mind reads the proven findings plus the AUTHORING run's trace (`--trace-dir`) and maps each finding to the worker whose deliverable claims its file — one `feedback/<name>.md` per party, their findings only, plus the please-check-and-refine contract. The mechanical floor (every blocked finding covered exactly once, none invented) is the divide stage's check; the wisdom of the mapping is judged by outcomes over time.
_Avoid_: blame agent, reviewer round, post-mortem

**Unreachable**:
A check whose earlier waves hold a failure — it can never be asked, so it cannot count against the run finishing. Terminal by rule; the run finishes honestly failed instead of waiting forever.
_Avoid_: deadlock, skipped (different concept)

**Football reading**:
The onboarding layer, not the canonical words: levy = the chairman (commissions the fixture, walks away, gets the full-time call); Job = a fixture at the Lane; worker = a player playing a position; brief = the manager's team talk; rail = the manager on the touchline (never leaves); wave = a wave of attack; check = a VAR check; wake = the result elsewhere; `done` = the shot; grade = does the goal stand; finish = full-time; pause/continue = half-time / the abandoned match resumed from the booked minute; deadline = stoppage time; blocked = an injury; report = the match report. Where football has no word (signal, slot, spawn, retire, arm), plain English wins — a faked metaphor word breaks the dictionary worse than an honest plain one.
_Avoid_: extending the metaphor into the machinery

**Fan-out**:
The workflow for independent units. Workers do not depend on each other. The orchestrator starts them and finishes results.
_Avoid_: fleet, hierarchy, swarm

**Canary**:
Fan-out's cost guard: the first unit runs alone; its grade passing releases the fleet to full slots, its failing stops the run honestly ("canary-stopped") instead of burning every unit on a broken pipe. Program policy, declared as `canary` in `[workflow]` (default on); `AGENTIC_OS_CANARY=0|1` overrides for one run. A program whose first-unit failure is a measured outcome, not a pipe break — a bench — declares it off.
_Avoid_: warm-up, smoke unit, serial prefix (a symptom, not the thing), gate (that is Jev or a check step)

**Coworker**:
The workflow for panes that depend on each other. Named members exchange typed message files on the Job dir; the Rail is the relay — it moves a message to the named pane's prompt. A worker never writes another worker. `kind = "coworker"` in `workflow.toml`. It must produce a report.
_Avoid_: social group, chat room, swarm, orchestrator-with-friends

**Direct**:
The workflow for one worker. That worker is the chat the user already has open. No pane is opened. No retry: the open chat is the supervisor — a blocked turn is visible and the user resends; unattended work belongs to a Job, not Direct. There is no finish and no report.
_Avoid_: single agent, dummy workflow, fallback, hidden retry script

**Rail**:
Machinery every workflow uses and none may rewrite: pane ledger, fail recovery, backpressure, the retry cap, and privilege control (the permission sweep). One implementation: the `Rail` in `src/rail.ts` — the bins are thin entries. Not the orchestrator's method. Not the layout.
_Avoid_: watcher, operator, script

**Brief grace**:
The rail's one rescue for a brief that never landed in a live pane: past the grace window, a pane with no log line AND an idle agent gets its brief re-submitted once; a working agent is evidence the brief landed and defers the rescue. A missing log alone proves nothing — the worker protocol writes nothing to the log until its single `done` line (j-78ca43: every unit past 90s was re-briefed mid-work before the heartbeat became the discriminator).
_Avoid_: stall (a different ladder — silence past the stall timeout), nudge, resend loop

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
How a workflow shows its panes. It belongs to that workflow. Fan-out gets its own tab: the orchestrator lane is one full-height pane on its side, and the worker column (configurable cap, default 2) takes the rest, split to equal heights. The tab opens beside the levy — the spawner pane names the workspace — and whoever opens it closes it: a fatal orchestrator closes what it opened on the way down. Direct opens no pane.
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

**Platform pen**:
The rail's completion write for status-first runs (ADR 0015): an idle pane with a present deliverable settles with no marker at all — the card carries `trigger: "idle+grade"`. The worker's own `done` marker (the worker pen) demotes to the fallback lane for status-blind panes; the `blocked` marker survives in both modes as the worker's escape hatch.
_Avoid_: auto-done, magic completion

**Evidence reprompt**:
The idle-with-no-deliverable nudge (ADR 0015): the note QUOTES the failing protocol check and names the required artifact — never a bare re-brief or a plea. Hard cap 8; past the cap the unit ends stalled-with-evidence with the check quoted on the trace.
_Avoid_: nag, poke

**Wait edge**:
One edge of the wait-for DAG: a wake receipt's `parentUnit` → its levied child `jid`. Live = the child's `wake.json` has not landed; a dangling edge folds to "not a wait". Acyclic by birth (every levy mints a fresh child job) — no cycle machinery exists.
_Avoid_: dependency, blocking link

**Station**:
One `[[stage]]` of a chain, ANY topology (solo, fan-out, coworker, lab, gate) — one word because they are managed identically. A station owns a folder in the one run tree (`briefs/`, `work/`, optional `messages/`/`protocol.json`/`verdict.txt`) and is hosted in-process by the engine that speaks its topology. A job is a run of the whole spur; stages are never jobs.
_Avoid_: child job, minted program, delegated stage

**Repair ticket**:
A parked run's wake when it carries the repair path, not just the verdict: the verbatim why, the failed artifact, and one line naming the cheapest next command (`continue` after a program fix — proven by the content-hash compare; resume with a repair note when panes still live).
_Avoid_: failure notice, death certificate

**Question bank**:
The committed `questions.toml` a run inherits and grows: the interviewer asks banked questions, may append new ones (append-only; `retired = true`, never erasure), and the audit checks every asked question is banked. Makes "same questions every run" true by construction instead of by model discipline.
_Avoid_: prompt library, FAQ

**Boot dispenser**:
`GET /api/boot` on the window server — the loopback-only handoff of the mutation bearer token to the window's own page. Every non-GET needs the token (`window.token`, 0600, OS disk root); the dispenser exists so the operator's browser is zero-config, not as a secret from the machine (local processes read the file anyway). Never answers a foreign Origin; a tailnet-opened page gets nothing and the window runs read-only.
_Avoid_: auth endpoint, login, session
