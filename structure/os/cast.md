### Setting (the system at a glance)

One machine, inside herdr. The user talks in a pi chat. Durable OS state is the session disk at `~/.local/share/agentic-os/sessions/s-60/`. Project bytes live in a bound git worktree, never as an OS copy. This plot walks one fan-out Job: three independent capital lookups. The other workflow, direct, opens no pane and does not finish.

| From | Edge | To |
|---|---|---|
| **first-mate** | `stand_up` task text | **scheduler** |
| **scheduler** | `fan-out 0.91` or `direct 0.84` | **first-mate** |
| **first-mate** | "enough to run?" | **grill** |
| **grill** | enough or ask | **first-mate** |
| **first-mate** | propose fan-out | **policy** |
| **policy** | admit or reject | **first-mate** |
| **first-mate** | `nohup` the run dir | **orchestrator** |
| **orchestrator** | `bash hooks/units.sh` and `grade` | **orchestrator↳hooks** |
| **orchestrator↳hooks** | JSONL units and a grade row | **orchestrator** |
| **orchestrator** | `shep spawn` / `retire` / `wake` | **shep** |
| **shep** | splits a pane in | **herdr** |
| **herdr** | hosts | **worker** |
| **worker** | `done france` on `log.txt` | **orchestrator** |
| **shep** | wake queue row | **first-mate** |

### Cast (who is who)

| Actor | What it actually is |
|---|---|
| **first-mate** | First Mate — the pi shell (`.pi/extensions/front-door.ts`). The user talks here. It routes, books the session, and shows a wake. It is not a pane and it does not take a worker's answer. |
| **scheduler** | `bin/pick-workflow`. Asks jev whether the task is independent units. Returns `fan-out` or `direct` plus a confidence. It does not run the task and it does not elect a leader. |
| **grill** | `src/grill.ts`. A jev yes/no: is the task specified enough to write hooks and run? Not enough stays in the chat. No pane. |
| **policy** | `src/policy.ts`. The admitting half of jev. The model proposes; these checks admit. Admission never spawns. |
| **orchestrator** | `bin/fan-out-orchestrator` — the fan-out workflow's detached script. It spawns, grades, and settles. It owns one helper: |
| ↳ **hooks** | The project's `units`, `grade`, and `counts` scripts, plus `slots` (per-task concurrency, default 2). Copied into `sessions/s-60/jobs/j-1/run/hooks/` so a run cannot rewrite the source. |
| **shep** | The pane toolbox. Opens, closes, and tracks panes. Owns the pane ledger and the wake queue. This product does not rewrite it. |
| **herdr** | The terminal multiplexer. Hosts the panes shep splits. |
| **worker** | An opencode or pi agent in one herdr pane. Does one unit, then is disposable. Its context window is scratch. |

### Terms (plain words)

| Term | Plain words |
|---|---|
| session | The First Mate conversation plus its OS disk at `sessions/s-60/`. May have no Job. Keyed by the host chat, not by the task. |
| Job | The managed group of panes on a session. Born at the first admitted spawn. `retired` is a state, not deletion. |
| binding | The session's record of repo and worktree path. Project bytes stay in that worktree. A worktree already bound to a live session is refused. |
| trace | The append-only `events.jsonl` on the session disk. Every route, admit, birth, settle, and wake is a line. Other records are projections of it. |
| jev | The birth canal. The model proposes; policy admits. Cheap typed judgment, not an agent and not a pane. No jev, no pane. |
| fan-out | The workflow for independent units. Workers do not depend on each other. It must end in a report. |
| direct | The other workflow. This chat is the worker. No pane, no retry rail, no finish, no report. |
| unit | One independent piece of work, with its own brief. Here: `france`, `japan`, `peru`. |
| slots | How many worker panes may run at once. A hook, default 2. A hand-set cap is not backpressure. |
| wake | One queued message that something happened and someone must look. A quiet success is not one. A Job may wake first-mate once, at the end. |
| receipt | The Job's finish line: panes of that Job remaining = 0. Session, binding, and Job record remain. |
| report | The readable finish fan-out must produce: a status, named counts, a table, and where to check. Direct does not produce one. |
| rail | Machinery every workflow uses and none may rewrite: the pane ledger, fail recovery, backpressure, and the retry cap. |
| backpressure | The provider refused or slowed. The rail retries that refusal only, with backoff, hard cap 3. Exit 75 means refusal. Anything else fails fast. |

### Examples (what the files hold)

| Token | What you would see in it |
|---|---|
| events.jsonl | {"ts":"2026-10-02T09:00:02Z","actor":"first_mate","kind":"grill","enough":true,"p":0.91}\n{"ts":"2026-10-02T09:00:03Z","actor":"first_mate","kind":"admit","workflow":"fan-out"}\n{"ts":"2026-10-02T09:01:21Z","actor":"orchestrator","kind":"unit.settled","unit":"france","pass":true,"result":"found"} |
| workflow.toml | [workflow]\nname = "three-lookups"\nworker_kind = "opencode"\nslots = 2 |
| units.jsonl | {"id":"france","brief":"Look up the capital of France. Write the city name to result.md."}\n{"id":"japan","brief":"Look up the capital of Japan. Write the city name to result.md."}\n{"id":"peru","brief":"Look up the capital of Peru. Write the city name to result.md."} |
| log.txt | done france |
| result.md | Paris |
| report.json | {"kind":"report","status":"done","counts":{"lookups":3,"failed":0},"table":[{"unit":"france","result":"found"},{"unit":"japan","result":"found"},{"unit":"peru","result":"found"}],"where":"units/"} |

### Fan-out (three lookups)

| T | Actor | What happens | → Next |
|---|---|---|---|
| T+0s | [first-mate] | The user types the task. **first-mate** calls `stand_up` with that text and does not answer it. Example: the tool call is `stand_up` with `Look up the capitals of France, Japan, and Peru.` | **[scheduler]** |
| T+1s | [scheduler] | The **scheduler** asks jev whether the lookups are independent. Example: `pick-workflow` prints `fan-out 0.91`. | **[first-mate]** |
| T+1s | [first-mate] | **first-mate** asks the **grill** whether the task is specified enough to run. Example: the question is `Is this task specified enough to write worker hooks and run without more questions?` | **[grill]** |
| T+2s | [grill] | The **grill** says yes. Example: `events.jsonl` gains a grill line, enough true, p 0.91. | **[first-mate]** |
| T+2s | [first-mate] | **first-mate** proposes fan-out. No pane exists yet. Example: the proposal is fan-out for three capital lookups. | **[policy]** |
| T+3s | [policy] | **policy** admits. No other Job is running, the manifest resolves, and slots are an integer of at least 1. Example: `workflow.toml` sets slots to 2. The admit line is `admit: true`. | **[first-mate]** |
| T+3s | [first-mate] | **first-mate** binds a worktree, creates the Job, copies hooks into the run dir, and starts the **orchestrator** detached. Example: `gwt spawn` prints `path: ~/toys/capitals/look-up-the-capitals-of`. The stood-up line names run `sessions/s-60/jobs/j-1/run`. | **[orchestrator]** |
| T+4s | [orchestrator] | The **orchestrator** calls the units hook before any worker pane exists. Example: the call is `bash hooks/units.sh` inside `sessions/s-60/jobs/j-1/run`. | **[orchestrator↳hooks]** |
| T+5s | [orchestrator↳hooks] | The **hooks** print three unit lines. Example: `units.jsonl` lists france, japan, and peru. | **[orchestrator]** |
| T+5s | [orchestrator] | The **orchestrator** tells **shep** to open the first worker panes. peru waits, because slots are 2. Example: the spawn is `shep spawn w-france`. | **[shep]** |
| T+6s | [shep] | **shep** splits a pane and books it on the ledger. Example: the ledger shows `w-france` running. | **[herdr]** |
| T+6s | [herdr] | **herdr** hosts that pane. Example: the pane title is `w-france`. | **[worker]** |
| T+20s | [worker] | The **worker** writes the city and appends a done line. japan takes the same hop in the other slot. Example: `result.md` is the line `Paris`. `log.txt` ends with `done france`. | **[orchestrator]** |
| T+21s | [orchestrator] | The **orchestrator** calls grade for france. Example: the grade call is `bash hooks/grade.sh france`. | **[orchestrator↳hooks]** |
| T+21s | [orchestrator↳hooks] | The **hooks** return pass. Example: the grade row a person would see is `found`. | **[orchestrator]** |
| T+21s | [orchestrator] | The **orchestrator** settles france and tells **shep** to retire that pane. Example: `events.jsonl` gains a unit.settled line for france, pass true. | **[shep]** |
| T+22s | [shep] | **shep** closes the france pane. peru can take the free slot. Example: the ledger shows `w-france` died. | **[orchestrator]** |
| T+90s | [orchestrator] | The **orchestrator** writes the report, retires the rest, and asks **shep** for one end wake. Example: `report.json` says status done and lookups 3. | **[shep]** |
| T+90s | [shep] | **shep** appends one wake row. The receipt is panes of this Job remaining = 0. Example: the wake text starts `report:`. | **[first-mate]** |
| T+100s | [first-mate] | **first-mate** shows the report and acks through N. It does not take the workers' answers. Example: the chat shows `status: done` and `lookups: 3`. The ack is `shep wake ack --through 7`. | — |
| — | [scheduler] | direct: The **scheduler** returns `direct 0.84`. This task is not independent units. Example: `pick-workflow` prints `direct 0.84`. | **[first-mate]** |
| — | [first-mate] | direct: **first-mate** does the task in this chat. No pane opens. No report is written. Example: the route line is `direct — this chat is the worker.` | — |
| — | [grill] | failure: The **grill** says the task is not specified enough. Example: the ask starts `Not enough to run yet.` | **[first-mate]** |
| — | [first-mate] | failure: **first-mate** asks what is missing and spawns nothing. Example: the chat says `Do not do the task. Do not spawn anything.` | — |
| — | [policy] | failure: **policy** rejects because a Job is already running. Example: the reject line is `a job is already running (1)`. | **[first-mate]** |
| — | [first-mate] | failure: **first-mate** starts no orchestrator. Example: the chat says `cannot fan-out: a job is already running (1)`. | — |
| — | [first-mate] | failure: The binding is refused. A live session already holds that worktree. Example: the reject line is `worktree already bound to a live session`. | — |
| — | [orchestrator↳hooks] | failure: The units hook exits 75. The provider refused. Example: the hook prints `planner refused` and exits 75. | **[orchestrator]** |
| — | [orchestrator] | failure: The **orchestrator** treats that as backpressure and retries, cap 3. A deterministic failure would not retry. Example: the log line is `backpressure: planner, attempt 1, waiting`. | **[orchestrator↳hooks]** |
| — | [worker] | failure: The **worker** cannot proceed and appends a blocked line. Example: `log.txt` says `blocked france: no source`. | **[orchestrator]** |
| — | [orchestrator] | failure: The **orchestrator** settles france failed and wakes itself. It does not wake **first-mate**. Example: the wake kind is `blocked` and the text is `blocked france: no source`. | **[shep]** |
| — | [orchestrator] | stall: No log growth for 10 minutes. The **orchestrator** retires the pane and records a stuck wake for itself. Example: the wake text is `no log output for 600000ms`. | **[shep]** |
| — | [first-mate] | death: The orchestrator pid is gone. **first-mate** parks the Job orphaned and does not relaunch it. Example: the chat says `Job j-1 orphaned (orchestrator gone) — parked, awaiting your call.` | — |

Coverage: first-mate ✓ scheduler ✓ grill ✓ policy ✓ orchestrator ✓ hooks ✓ shep ✓ herdr ✓ worker ✓
Terms: session ✓ Job ✓ binding ✓ trace ✓ jev ✓ fan-out ✓ direct ✓ unit ✓ slots ✓ wake ✓ receipt ✓ report ✓ rail ✓ backpressure ✓
Invariant: no pane is born without an admit, and a Job is finished only when the receipt says panes of that Job remaining = 0.
