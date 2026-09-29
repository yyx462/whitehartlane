# Agentic OS

A TUI the user types a task into. It stands up a workflow of sub-panes. It does not do the task itself.

## Language

**Front door**:
The pi TUI the user types a task into.
_Avoid_: orchestrator, shepherd, scheduler, product-as-worker

**Workflow**:
A component that receives an input and has an orchestrator. Fan-out must produce a report. Direct must not finish. Orchestrator rules belong to that workflow. A project fills hooks. A project does not skip fan-out's report.
_Avoid_: hierarchy, fleet, driver, custom script

**Scheduler**:
The part that picks a workflow for a task. It does not run the task and it does not elect a leader.
_Avoid_: orchestrator, driver, jev

**Jev**:
A cheap typed judgment. Code sends it state and a question; it returns a calibrated pick or a probability. Not an agent and not a pane.
_Avoid_: router model, LLM scheduler, subagent

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
The workflow for one worker. That worker is the chat the user already has open. No pane is opened. A hidden script retries only when the worker is blocked, and only up to the cap. If the cap is hit, the worker says so in that same chat. There is no finish and no report.
_Avoid_: single agent, dummy workflow, fallback

**Rail**:
Machinery every workflow uses and none may rewrite: pane ledger, fail recovery, backpressure, and the retry cap. Not the orchestrator's method. Not the layout.
_Avoid_: watcher, operator, script

**Hook**:
The task-specific part a project fills in: what one unit of work is, the worker brief, how to grade, where artifacts go, and which counts the report shows.
_Avoid_: workflow, rail, operator

**Report**:
The readable output fan-out must produce when it finishes. It has a status, named counts, a table, and where to check. The front door shows it. Direct does not produce one.
_Avoid_: log, dashboard, one-line path

**Outliving memory**:
State that remains after the worker that wrote it is gone, so another worker can resume. Not the context window.
_Avoid_: snapshot, context, chat history

**Ownership**:
A recorded fact that one object is the parent of a worker or of an artifact. The `shep` ledger owns panes. The task directory owns progress and output. The two differ.
_Avoid_: leader, lease, "I spawned it"

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
The directory the agent was opened in. Progress and output live there. The front door does not invent another folder.
_Avoid_: a folder named from the task
