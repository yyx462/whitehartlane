# agentic-os runs a spur program — the organs of the lab rail

### Setting (the system at a glance)

Two repos on one operator machine. `agentic-program` holds programs; `agentic-os` is the shell that runs them. Durability is the filesystem: a Job's run dir and `events.jsonl` are the only truth after a pane dies.

| From | Edge | To |
|---|---|---|
| **agentic-program** | holds | **skill-rsi** |
| **agentic-os** | holds | **run door** |
| **agentic-os** | runs | **lab rail** |
| **os-disk** | owns | **job dir** |
| **os-mechanism** | runs | **hooks** |
| **skill-rsi** | `agentic-os run skill-rsi/workflow` | **run door** |
| **run door** | stages `spur.mjs` into | **job dir** |
| **run door** | appends the admit line to | **storage** |
| **job dir** | wakes on file change or the 30s beat | **watcher** |
| **watcher** | pours the photograph into | **spur.ts** |
| **spur.ts** | `tick()` returns actions to | **hands** |
| **hands** | births + briefs the actor pane | **professor** |
| **professor** | writes `protocol.json`, read as the signal by | **watcher** |
| **hands** | births per protocol unit | **students** |
| **stagehand** | splits panes for | **students** |
| **students** | append `done <id>` lines, read as ends by | **watcher** |
| **hands** | calls the grade command in | **hooks** |
| **hooks** | grade writes `scorecard.json` back to | **hands** |
| **hands** | prompts on a blocked student | **orchestrator pane** |
| **ledger clerk** | appends every event to | **storage** |
| **hands** | writes `report.json`, receipt printed by | **skill-rsi** |

### Cast (who is who)

| Actor | What it actually is |
|---|---|
| **agentic-program** | the program repo — every program is a tenant here (folder); first tenant: |
| ↳ **skill-rsi** | `skill-rsi/` — the first program: `bin/skill-rsi` (CLI `pass <skill>`), `src/pass.mjs` (the wait loop) |
| ↳ **workflow folder** | `skill-rsi/workflow/` — the program itself: `spur.mjs` names the steps, `workflow.toml` names the hooks |
| **agentic-os** | the OS repo — shell and supervisor (folder); parts: |
| ↳ **run door** | `src/run.ts` behind `bin/agentic-os run` — validates the spur, books the Job, stages it |
| ↳ **spur.ts** | `src/spur.ts` — the brain: `tick(spur, photograph) → actions`. Pure: no files, no clock, no memory between calls. Not a process — one call per heartbeat, then it is gone |
| ↳ **lab rail** | `bin/lab-orchestrator` — the one live process, and it is a body, not a mind. Four organs inside: |
| ↳ **watcher** | the heartbeat: a `while` loop that sleeps on the job dir (`fs.watch`) or a 30s backstop beat; each wake gathers the photograph — disk (`protocol.json`, `log.txt`), rail memory (`done`, `graded`, `openedWave`), herdr liveness — then calls tick, then hands obey |
| ↳ **hands** | the obey loop: executes tick's actions — births and retires panes (shep + herdr), runs the grade hook, briefs and prompts agents, writes `report.json` |
| ↳ **stagehand** | layout only: herdr tabs and splits that place the orchestrator pane, the actor, and the students |
| ↳ **ledger clerk** | bookkeeping, best-effort: appends `events.jsonl`, keeps `job.json`; never blocks the rail |
| **os-disk** | the OS disk under `~/.local/share/agentic-os` (folder) — the physical place every Job leaves its truth: |
| ↳ **storage** | `storage/` in the OS home — every session's `events.jsonl` and Job records; outlives every pane |
| ↳ **job dir** | the staged run dir `storage/sessions/<sid>/jobs/<jid>/run/` — staged `spur.mjs` + `workflow.toml`, then `protocol.json`, `units/`, `report.json` |
| **os-mechanism** | abstract machinery the OS stands up and runs (mechanism) — panes and hook commands, not repos: |
| ↳ **orchestrator pane** | a pi agent born idle — the only other mind in the run, prompted only when a student is blocked. Not the lab rail, not fan-out's `orchestrator.ts` |
| ↳ **professor** | the actor pane (a pi agent with the `actor.md` brief) — writes `protocol.json`, decides when to stop |
| ↳ **students** | mock panes, one per protocol unit — each runs one case in `units/<id>/` and appends a done line |
| ↳ **hooks** | the program's `workflow/hooks/grade.mjs` + `counts.mjs`, named by `workflow.toml`; grade writes `scorecard.json` |

### Terms (plain words)

| Term | Plain words |
|---|---|
| Spur | a list of named steps where each step says which steps it waits on (`after`); the file is data, never executed |
| program | one `spur.mjs` file (plus an optional `workflow.toml` for hooks) that agentic-os runs |
| heartbeat | one turn of the watcher's `while` loop: sleep → wake on a file change (or the 30s backstop beat) → gather the photograph → tick decides → hands obey → sleep |
| photograph | the `TickIn` object the watcher pours each wake: the professor's word (signal, waveKey), each student's end, and the rail's own memory (done, graded, openedWave, prompted) — from disk, rail RAM, and herdr |
| tick | NOT a process and NOT a timer. One pure function call: photograph in, actions out. It reads no file and checks nothing — the watcher does that. Runs once per heartbeat, then it is gone |
| Job | the OS record of one run: run dir, panes, receipt; booked by `book` |
| protocol | `protocol.json`, the professor's next-wave file: units with `id` + `brief`, or the stop flag to finish |
| wave | one batch of students named by one protocol |
| reopen | when a new protocol arrives after a closed wave, tick clears students and grade so the cycle can run again |

### The run (happy path, actor-tagged)

| T | Actor | What happens | → Next |
|---|---|---|---|
| T+0s | [skill-rsi] | The user runs `skill-rsi pass <skill>`; it shells the **run door** with the workflow folder. Example: the command is `skill-rsi pass` and the door answers `job: j-f5e6c5`. | **[run door]** |
| T+0s | [run door] | The **run door** validates `spur.mjs` with `parseSpur`, then books the Job and stages `spur.mjs` beside `workflow.toml` in the **job dir**. Example: a program that schedules or calls is refused with `a program does not schedule`, and nothing is booked. | **[job dir]** |
| T+1s | [ledger clerk] | The **ledger clerk** appends the admit line to `events.jsonl`. Example: the line holds `kind: "admit"`, `jid: "j-f5e6c5"`, `workflow: "lab"`. | **[stagehand]** |
| T+1s | [stagehand] | The **stagehand** opens the fleet tab and splits the panes: a lane for the orchestrator, a column for students. Example: the log gains `fleet tab fan-out-<dir> opened`. | **[watcher]** |
| T+2s | [watcher] | Heartbeat 1: the **watcher** wakes (30s beat), gathers the photograph — no signal yet, nothing born — and calls tick. Example: the photograph says `signal: "missing"`, `actorBorn: false`. | **[spur.ts]** |
| T+2s | [spur.ts] | The brain decides from the photograph alone: no actor yet → `birth-actor`. Example: `tick` returns `[{do: "birth-actor"}]` and is gone. | **[hands]** |
| T+2s | [hands] | The **hands** obey: birth the professor pane and submit the brief. Example: the log gains `name actor pane 412`. | **[professor]** |
| T+90s | [professor] | The **professor** writes `protocol.json` naming the first wave of students. Example: one unit, id `cast-tight`, a brief for the wake pipeline. | **[watcher]** |
| T+90s | [watcher] | Heartbeat 2: the dir watch fires at once. The **watcher** photographs: `signal: "wave"`, `waveKey: "cast-tight"`. Example: the photograph now holds the professor's word. | **[spur.ts]** |
| T+90s | [spur.ts] | The brain says: finish the actor step, birth the wave. Example: `tick` returns `finish` then `birth-wave`. | **[hands]** |
| T+91s | [hands] | The **hands** birth one **student** per protocol unit; the stagehand has the panes ready. Example: the log gains `name mock-cast-tight pane 415`. | **[students]** |
| T+8m | [students] | Each **student** runs its case and appends a done line to `log.txt`. Example: `log.txt` ends with `done cast-tight`. | **[watcher]** |
| T+8m | [watcher] | Heartbeat 3: the **watcher** photographs — every end is `done`, none graded. Example: `ends: [{cast-tight, done}]`, `graded: []`. | **[spur.ts]** |
| T+8m | [spur.ts] | The brain says: grade the done student, and once grading settles, prompt the actor. Example: `tick` returns `grade` now, `prompt-actor` next beat. | **[hands]** |
| T+8m | [hands] | The **hands** run the grade hook in **hooks**; the scorecard lands. Example: `scorecard.json` says pass true, weight 0.78. | **[professor]** |
| T+20m | [professor] | The **professor** writes a second protocol with new prototypes; the wave key differs. Example: `protocol.json` now holds unit `tighter-rs`. | **[spur.ts]** |
| T+20m | [spur.ts] | The brain compares waveKey against openedWave: they differ → `reopen`. Example: `tick` returns `reopen` for students and grade. | **[hands]** |
| T+20m | [hands] | The **hands** clear the old wave and birth the new students; the stagehand re-splits the column. Example: the log gains `reopen students, grade`. | **[students]** |
| T+40m | [professor] | The **professor** writes the stop protocol. Example: `protocol.json` is one line, `{"stop": true}`. | **[spur.ts]** |
| T+40m | [spur.ts] | The brain finishes the open steps and says `report`. Example: `tick` returns `finish` for each step, then `report`. | **[hands]** |
| T+40m | [hands] | The **hands** write `report.json`, retire every pane; the ledger clerk finishes the Job. Example: `report.json` says status done, 3 passed. | **[skill-rsi]** |
| T+40m | [skill-rsi] | **skill-rsi**'s wait loop sees the receipt in `report.json` and prints the report path. Example: the terminal prints `report: done scenarios 3 passed 3`. | — |
| T+9m | [hands] | failure: a student blocks → the **hands** prompt the **orchestrator pane**, the only other mind, and only then. Example: the prompt says `mock-cast-tight is blocked: name that pane. Do not spawn.` | **[orchestrator pane]** |
| T+90s | [watcher] | failure: the dir watch misses an event → the 30s backstop beat still wakes the **watcher**. Example: `waitChange` resolves on the timer, `the timer is the backstop`. | **[spur.ts]** |

### Examples (what the files hold)

| Token | What you would see in it |
|---|---|
| spur.mjs | # skill-rsi/workflow/spur.mjs — the whole program: steps, nothing else\nexport const spur = {\n  name: "skill-rsi",\n  steps: [\n    { id: "professor", does: "actor" },\n    { id: "students", does: "wave", after: ["professor"] },\n    { id: "grade", does: "grade", after: ["students"] },\n    { id: "report", does: "report", after: ["grade"] },\n  ],\n} |
| workflow.toml | # skill-rsi/workflow/workflow.toml — hooks and worker kind; the steps live in spur.mjs\n[workflow]\nname = "skill-rsi"\nkind = "lab"\nworker_kind = "opencode"\n\n[hooks]\ngrade = "node hooks/grade.mjs"\ncounts = "node hooks/counts.mjs" |
| run.ts | // run.ts — agentic-os/src: the run door; finds the spur, books the Job\nexport function spurFileOf(input) {\n  const resolved = resolve(input)\n  if (statSync(resolved).isFile())\n    return basename(resolved) === "spur.mjs" ? resolved : null\n  return existsSync(join(resolved, "spur.mjs")) ? join(resolved, "spur.mjs") : null\n} |
| spur.ts | // spur.ts — agentic-os/src: the brain; pure, called once per heartbeat\nexport function tick(spur, state) {\n  // state in: done, actorBorn, signal, waveKey, openedWave, ends, graded, prompted\n  // actions out: birth-actor, birth-wave, grade, prompt-actor, finish, reopen, report\n} |
| lab-orchestrator | // bin/lab-orchestrator — the rail: watcher loop + hands + stagehand + ledger\nwhile (Date.now() < deadline) {\n  const signal = readSignal(taskDir) // disk: protocol.json\n  const ends = [...born].map(mockEnd) // disk: log.txt + herdr liveness\n  const actions = tick(spur, { done, signal, ends, graded, ... }) // photograph\n  for (const action of actions) hands(action) // obey\n  await waitChange(taskDir, 30_000) // sleep: fs.watch OR 30s backstop\n} |
| orchestrator-pane-prompt | mock-cast-tight is blocked: waiting for a permission or a decision. Name that pane. Do not spawn. |
| pass.mjs | // pass.mjs — skill-rsi/src: the wait loop; the program never relaunches\nconst started = spawn(osBin(), ["run", folder], {\n  SKILL_RSI_TARGET: ready.dir,\n})\n// then: read the Job record until a receipt or an abort,\n// print the report path, exit 0 only on status done |
| protocol.json | {"units":[{"id":"cast-tight","brief":"load yyx-design-cast, explain the wake pipeline"}]} |
| log.txt | loaded skill yyx-design-cast\nwrote result.md\ndone cast-tight |
| scorecard.json | {"id":"cast-tight","pass":true,"weight":0.78,"reasoning_tokens":2140,"tool_calls":3} |
| report.json | {"status":"done","counts":{"scenarios":3,"passed":3,"failed":0}} |
| events.jsonl | {"actor":"cli","kind":"admit","jid":"j-f5e6c5","workflow":"lab"} |

Coverage: agentic-program ✓ skill-rsi ✓ workflow folder ✓ agentic-os ✓ run door ✓ spur.ts ✓ lab rail ✓ watcher ✓ hands ✓ stagehand ✓ ledger clerk ✓ storage ✓ job dir ✓ orchestrator pane ✓ professor ✓ students ✓ hooks ✓
Terms: Spur ✓ program ✓ heartbeat ✓ photograph ✓ tick ✓ Job ✓ protocol ✓ wave ✓ reopen ✓
Invariant: the watcher is the heartbeat, tick is one pure call per beat — state lives in files and rail memory, never inside the brain.
