# Three panes

The OS half. The job half lives in the program. skill-rsi's is `agentic-program/master/skill-rsi/docs/prd.md`.

`docs/prd/live-orchestrator.md` and `docs/prd/skill-rsi.md` folded the Actor into the Orchestrator. Do not follow them.

`whitehartlane run` is the only entry. The Rail births panes, names them, stores results, and wakes. A workflow with no Actor still finishes when the Wave ends. That is today's fan-out.

## Picture

```text
whitehartlane run
  Rail births the named panes. It never replaces a live pane.

orchestrator
  stays idle. It does not run herdr. It does not watch.
  The Rail prompts it when a pane is blocked.
  It writes one decision and stops.
  You do not write protocol.json. You do not spawn. You do not call shep.

actor
  writes protocol.json
  goes idle
        |
        |  the Protocol file is the signal. Idle alone is not.
        v
Rail
  reads the Protocol
  births mock-<id>
        |
        |  a blocked Mock wakes the orchestrator
        |  every Mock has an End
        v
Rail
  a Mock's End calls the grade hook
  stores each trace pointer and result
  the counts hook names the report
  prompts the same actor pane
```

What the Actor looks at, and what a Mock runs, are the job. The OS does not know.

## Law

- The Actor writes the Protocol. The Orchestrator does not.
- Neither live pane calls shep. The Rail does.
- The Rail does not decide the next Wave. The Actor does.
- A pane has a name a person can say: `orchestrator`, `actor`, or `mock-<id>`. A cut shep label is not a name.
- A quiet success does not wake First Mate. A blocked Mock wakes the Orchestrator.
- The Orchestrator does not babysit. Idle means no tool call. `herdr agent wait` in that pane is a bug.
- The Rail is the watcher. It subscribes to herdr agent state and to the Job dir. A permission dialog is herdr `blocked`. The worker writes no log line while that dialog is up, so the Rail must name that End itself.
- Known roots are granted before a Mock starts: the Job dir, and the target the program passed. That is how the common ask never appears.
- If a pane is still blocked, the Rail prompts the Orchestrator once, with the pane name and the path. The Orchestrator writes one decision, `allow <path>` or `leave`, and stops. The Rail applies it and reprompts the Mock. The Orchestrator does not press the dialog.
- The Host session is not copied. The Session stores a pointer.
- The Protocol and the results live on the Job dir. The run does not write the source.
- No second scheduler. No chunk pool in the Rail.
- Promote is never part of the Job.
- A live run calls the grade hook when a Mock ends, and the counts hook when the Job stops. The Rail does not invent the grade or the count names. Skipping the hook and writing `mocks` is a bug.
- The Rail does not know the grader. Jev is not in the Rail.
- The Rail does not render HTML. A program may.
- Prototypes are not an OS folder. The Job dir may hold a pointer. The Rail does not own the asset.
- Verbose is a display of the Rail, not a fourth worker. `verbose = true` in the workflow, or `whitehartlane run <folder> --verbose`, opens one more tab that tails a short log. A line names who moved what: `rail`, `watcher`, or `operator`. The same state again writes nothing. A spin is not a line.
- The operator closes a Mock pane when that pane's End is done. A blocked pane stays, so the dialog remains visible. Ten waves do not leave nine finished panes.

## Stages

Each stage is done only when its test is green. Do not start the next on a red test.

1. **Three names.** A pane record has a role name. A missing name fails. Test: `test/name.test.ts`.
2. **The Orchestrator prompt is the ledger.** A brief that tells it to write the Protocol fails. Test: `test/orchestrator-brief.test.ts`.
3. **The Protocol is the signal.** No file, no Mock. A complete file births a Wave record and does not spawn on idle alone. The writer is the Actor. Test: `test/protocol.test.ts`.
4. **Mocks are born from the Protocol.** `live = true` does not run the units hook as the birth. Test: `test/wave.test.ts`.
5. **A blocked Mock wakes the Orchestrator.** A done Mock does not. A permission dialog counts as blocked even when the log is empty. The Orchestrator brief forbids `herdr`. Test: `test/wake-orchestrator.test.ts` and `test/orchestrator-brief.test.ts`.
6. **The Actor is prompted when the Wave ends.** Same pane id. The Orchestrator is not prompted with the results. Test: `test/actor-prompt.test.ts`.
7. **A live run calls the grade hook.** A Mock End invokes it. The report's count names come from the counts hook. A report that invents `mocks` fails. Test: `test/live-grade.test.ts`.
