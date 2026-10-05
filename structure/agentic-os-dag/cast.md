# agentic-os runs a DAG program — how skill-rsi became one file

### Setting (the system at a glance)

Two repos on one operator machine. `agentic-program` holds programs; `agentic-os` is the shell that runs them. Durability is the filesystem: a Job's run dir and `events.jsonl` are the only truth after a pane dies.

| From | Edge | To |
|---|---|---|
| **agentic-program** | holds | **skill-rsi** |
| **agentic-os** | holds | **run door** |
| **os-disk** | owns | **job dir** |
| **os-mechanism** | runs | **hooks** |
| **skill-rsi** | `agentic-os run skill-rsi/workflow` | **run door** |
| **run door** | books Job, stages `dag.mjs` into | **job dir** |
| **run door** | appends the admit line to | **storage** |
| **job dir** | hands the staged program to | **lab-orchestrator** |
| **lab-orchestrator** | loads steps from | **dag.ts** |
| **dag.ts** | `tick()` actions | **lab-orchestrator** |
| **lab-orchestrator** | births + briefs the actor pane | **professor** |
| **professor** | writes `protocol.json` | **lab-orchestrator** |
| **lab-orchestrator** | births per wave | **students** |
| **students** | append `done <id>` to `log.txt` | **hooks** |
| **hooks** | grade writes `scorecard.json` | **lab-orchestrator** |
| **lab-orchestrator** | writes `report.json`, receipt printed by | **skill-rsi** |

### Cast (who is who)

| Actor | What it actually is |
|---|---|
| **agentic-program** | the program repo — every program is a tenant here (folder); first tenant: |
| ↳ **skill-rsi** | `skill-rsi/` — the first program: `bin/skill-rsi` (CLI `pass <skill>`), `src/pass.mjs` (the wait loop) |
| ↳ **workflow folder** | `skill-rsi/workflow/` — the program itself: `dag.mjs` names the steps, `workflow.toml` names the hooks |
| **agentic-os** | the OS repo — shell and supervisor (folder); parts: |
| ↳ **run door** | `src/run.ts` behind `bin/agentic-os run` — `dagFileOf` finds the dag, `book` creates the Job and stages it |
| ↳ **dag.ts** | `src/dag.ts` — the only scheduler: `assertProgram` (a program may not schedule or call), `parseDag` (file as data), `tick` (state in, actions out) |
| ↳ **lab-orchestrator** | `bin/lab-orchestrator` — the lab rail: executes `tick`'s actions, births and retires panes |
| **os-disk** | the OS disk under `~/.local/share/agentic-os` (folder) — the physical place every Job leaves its truth: |
| ↳ **storage** | `storage/` in the OS home — every session's `events.jsonl` and Job records; outlives every pane |
| ↳ **job dir** | the staged run dir `storage/sessions/<sid>/jobs/<jid>/run/` — staged `dag.mjs` + `workflow.toml`, then `protocol.json`, `units/`, `report.json` |
| **os-mechanism** | abstract machinery the OS stands up and runs (mechanism) — panes and hook commands, not repos: |
| ↳ **professor** | the actor pane (a pi agent with the `actor.md` brief) — writes `protocol.json`, decides when to stop |
| ↳ **students** | mock panes, one per protocol unit — each runs one case in `units/<id>/` and appends a done line |
| ↳ **hooks** | the program's `workflow/hooks/grade.mjs` + `counts.mjs`, named by `workflow.toml`; grade writes `scorecard.json` |

### Terms (plain words)

| Term | Plain words |
|---|---|
| DAG | a list of named steps where each step says which steps it waits on (`after`); the file is data, never executed |
| program | one `dag.mjs` file (plus an optional `workflow.toml` for hooks) that agentic-os runs |
| tick | the pure function in dag.ts: it reads the step list plus run state and returns the next actions; the only scheduler |
| Job | the OS record of one run: run dir, panes, receipt; booked by `book` |
| protocol | `protocol.json`, the professor's next-wave file: units with `id` + `brief`, or the stop flag to finish |
| wave | one batch of students named by one protocol |
| reopen | when a new protocol arrives after a closed wave, tick clears students and grade so the cycle can run again |

### The run (happy path, actor-tagged)

| T | Actor | What happens | → Next |
|---|---|---|---|
| T+0s | [agentic-program] | **agentic-program** holds the program: `skill-rsi` and its `workflow folder`. Example: `dag.mjs` holds the four steps — professor, students, grade, report — and nothing else. | **[skill-rsi]** |
| T+0s | [workflow folder] | The **workflow folder** is the whole program: `dag.mjs` names the steps, `workflow.toml` names the hooks. Example: `workflow.toml` sets `kind = "lab"` and the grade hook. | **[agentic-os]** |
| T+0s | [agentic-os] | **agentic-os** holds the door and the scheduler in src, the two rails in bin. Example: the door is `run.ts` in src; the lab rail is `lab-orchestrator` in bin. | **[skill-rsi]** |
| T+0s | [skill-rsi] | The user runs `skill-rsi pass <skill>`; **skill-rsi** shells the **run door** with the workflow folder. Example: the command is `skill-rsi pass` and the door answers `job: j-f5e6c5`. | **[run door]** |
| T+0s | [run door] | The **run door**'s `dagFileOf` finds `dag.mjs` in the folder and hands it to `parseDag` for validation. Example: `run.ts` refuses a scheduling program with `a program does not schedule`. | **[dag.ts]** |
| T+1s | [dag.ts] | **dag.ts** reads `dag.mjs` as data: quotes the keys, parses JSON, checks verbs and `after` links. Example: `dag.ts` orders the steps professor, then students, then grade, then report. | **[run door]** |
| T+1s | [run door] | The **run door**'s `book` creates the Job and stages `dag.mjs` beside `workflow.toml` in the **job dir**. Example: the run dir holds `dag.mjs`, `workflow.toml`, `orchestrator.log`. | **[job dir]** |
| T+1s | [job dir] | The **job dir** now holds the staged program; every later write lands here and nothing edits the program repo. Example: `protocol.json` will be born beside the staged `dag.mjs`. | **[lab-orchestrator]** |
| T+1s | [storage] | **storage** keeps the admit line in `events.jsonl` — every event outlives its pane. Example: `events.jsonl` gains the admit line with `workflow: lab`. | **[lab-orchestrator]** |
| T+2s | [lab-orchestrator] | The **lab-orchestrator** loads the staged `dag.mjs`; tick says `birth-actor`; the rail births the pane. Example: `lab-orchestrator` logs `name actor pane 412` — the code that obeys tick. | **[professor]** |
| T+90s | [professor] | The **professor** writes `protocol.json` naming the first wave of students. Example: `protocol.json` holds one unit: id `cast-tight`, a brief for the wake pipeline. | **[lab-orchestrator]** |
| T+91s | [dag.ts] | **dag.ts** sees the wave: finish professor, birth-wave. Example: `dag.ts` returns finish then birth-wave. | **[lab-orchestrator]** |
| T+91s | [lab-orchestrator] | The **lab-orchestrator** births one **student** per protocol unit. Example: the log gains `name mock-cast-tight pane 415`. | **[students]** |
| T+8m | [students] | Each **student** runs its case and appends a done line to `log.txt`. Example: `log.txt` ends with `done cast-tight`. | **[hooks]** |
| T+8m | [hooks] | The grade hook writes the scorecard for each done unit. Example: `scorecard.json` says pass true, weight 0.78. | **[dag.ts]** |
| T+9m | [dag.ts] | Grading settled, **dag.ts** says `prompt-actor`. Example: `dag.ts` returns prompt-actor once every done end is graded. | **[professor]** |
| T+20m | [professor] | The **professor** writes a second protocol with new prototypes; the wave key differs. Example: `protocol.json` now holds unit `tighter-rs`. | **[dag.ts]** |
| T+20m | [dag.ts] | **dag.ts** reopens students and grade for the new cycle. Example: `dag.ts` returns reopen for students and grade. | **[lab-orchestrator]** |
| T+40m | [professor] | The **professor** writes the stop protocol. Example: `protocol.json` is the stop flag — one line, true. | **[dag.ts]** |
| T+40m | [dag.ts] | **dag.ts** finishes the open steps and says `report`. Example: `dag.ts` returns finish for each step, then report. | **[lab-orchestrator]** |
| T+40m | [lab-orchestrator] | The **lab-orchestrator** writes `report.json` and retires every pane. Example: `report.json` says status done, 3 passed. | **[skill-rsi]** |
| T+40m | [skill-rsi] | **skill-rsi**'s wait loop sees the receipt in `report.json` and prints the report path. Example: `pass.mjs` exits 0 only on status done; the terminal prints `report: done scenarios 3 passed 3`. | — |
| T+0s | [run door] | failure: a dag that schedules or calls is refused at the door. Example: the run prints `run: a program does not schedule` and books nothing. | — |
| T+1s | [dag.ts] | failure: a cyclic dag never books. Example: `dag.ts` raises `dag is cyclic` during `parseDag`. | — |

### Examples (what the files hold)

| Token | What you would see in it |
|---|---|
| dag.mjs | # skill-rsi/workflow/dag.mjs — the whole program: steps, nothing else\nexport const dag = {\n  name: "skill-rsi",\n  steps: [\n    { id: "professor", does: "actor" },\n    { id: "students", does: "wave", after: ["professor"] },\n    { id: "grade", does: "grade", after: ["students"] },\n    { id: "report", does: "report", after: ["grade"] },\n  ],\n} |
| workflow.toml | # skill-rsi/workflow/workflow.toml — hooks and worker kind; the steps live in dag.mjs\n[workflow]\nname = "skill-rsi"\nkind = "lab"\nworker_kind = "opencode"\n\n[hooks]\ngrade = "node hooks/grade.mjs"\ncounts = "node hooks/counts.mjs" |
| run.ts | // run.ts — agentic-os/src: the run door; finds the dag, books the Job\nexport function dagFileOf(input) {\n  const resolved = resolve(input)\n  if (statSync(resolved).isFile())\n    return basename(resolved) === "dag.mjs" ? resolved : null\n  return existsSync(join(resolved, "dag.mjs")) ? join(resolved, "dag.mjs") : null\n}\n\nfunction book(dir, kind, task, slots, stage) {\n  // task.txt override, policy admit, session,\n  // createJob, stage(job.dir), admit event\n} |
| dag.ts | // dag.ts — agentic-os/src: the only scheduler; the file is read, never run\nexport function assertProgram(source) {\n  // SCHEDULER = /fan-out-orchestrator, child_process, while, spawn, setInterval, scheduler/\n  if (SCHEDULER.test(source)) throw new Error("a program does not schedule")\n  const code = source.replace(/"(?:[^"\\])*"/g, '""')\n  if (code.includes("(")) throw new Error("a program names steps; it does not call")\n}\n\nexport function tick(dag, state) {\n  // state in: done, signal, ends, graded, prompted\n  // actions out: birth-actor, birth-wave, grade,\n  //   prompt-actor, finish, reopen, report\n} |
| lab-orchestrator | // lab-orchestrator — agentic-os/bin: the rail executes tick's actions\nconst dag = loadDagFile(join(taskDir, "dag.mjs")) // read, never run\nconst actions = tick(dag, {\n  done, actorBorn, signal, waveKey, openedWave, ends, graded, prompted,\n})\nfor (const action of actions) {\n  if (action.do === "birth-actor") birthActor()\n  if (action.do === "birth-wave") spawnWave(signal.wave.units)\n  if (action.do === "grade") gradeUnit(action.id)\n  if (action.do === "prompt-actor") promptActor(ends)\n  if (action.do === "reopen") clearUnits()\n  if (action.do === "report") stopNow = true\n} |
| pass.mjs | // pass.mjs — skill-rsi/src: the wait loop; the program never relaunches\nconst started = spawn(osBin(), ["run", folder], {\n  SKILL_RSI_TARGET: ready.dir,\n})\n// then: read the Job record until a receipt or an abort,\n// print the report path, exit 0 only on status done |
| protocol.json | {"units":[{"id":"cast-tight","brief":"load yyx-design-cast, explain the wake pipeline"}]} |
| log.txt | loaded skill yyx-design-cast\nwrote result.md\ndone cast-tight |
| scorecard.json | {"id":"cast-tight","pass":true,"weight":0.78,"reasoning_tokens":2140,"tool_calls":3} |
| report.json | {"status":"done","counts":{"scenarios":3,"passed":3,"failed":0}} |
| events.jsonl | {"actor":"cli","kind":"admit","jid":"j-f5e6c5","workflow":"lab"} |

Coverage: agentic-program ✓ skill-rsi ✓ workflow folder ✓ agentic-os ✓ run door ✓ dag.ts ✓ lab-orchestrator ✓ storage ✓ job dir ✓ professor ✓ students ✓ hooks ✓
Terms: DAG ✓ program ✓ tick ✓ Job ✓ protocol ✓ wave ✓ reopen ✓
Invariant: the file names steps, tick decides, the rail obeys — a program can never become a second scheduler because it is read, not run.
