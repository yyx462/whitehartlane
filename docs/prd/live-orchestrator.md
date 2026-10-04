# Live orchestrator

`agentic-os run` is the only entry. The Rail births panes, names Ends, stores results, and prompts. A workflow that must remember names one live Orchestrator. A workflow that does not still finishes when the Wave ends. That is today's fan-out. skill-rsi is the first workflow that uses the live pane.

The words Operator and Watcher are not nouns. The glossary already lists them under Rail, to avoid. Splitting them into products is how the system diverges.

## Picture

```text
agentic-os run
  Rail births the Orchestrator pane once. It never replaces it.

Orchestrator (one live pane, holds the Host session)
  writes a Protocol on the Job dir
  goes idle
        |
        |  the Protocol file is the signal. Idle alone is not.
        v
Rail
  reads the Protocol
  births the Wave
        |
        |  each pane gets an End: done, blocked, dead, waiting, rate-limit, ...
        v
Rail
  stores each trace pointer and result on the Job dir
  waits until every pane in the Wave has an End
  prompts the same Orchestrator pane
        |
        v
Orchestrator
  reads the feedback in the same Host session
  writes the next Protocol, or stops
```

## Law

- The Orchestrator does not call shep. The Rail does.
- The Rail does not decide the next Wave. The Orchestrator does.
- A quiet success does not wake First Mate. An End is not a Wake.
- The Host session is not copied. The Session stores a pointer.
- The Protocol and the results live on the Job dir. The source is not written by the run.
- No second scheduler. No chunk pool in the Rail. Splitting a unit is a Hook, and only if that Hook says a unit can return unfinished work.
- Promote is never part of the Job.

## Ends

herdr already names `done`, `blocked`, `idle`, `working`, `unknown`. A missing pane is `dead`. The Rail adds a name only for what herdr does not name. Waiting on a permission, a rate limit, and an accidental exit are different Ends. They are not one word, stuck. A pane with no End holds the Wave, so every pane must get one.

## Stages

Each stage is done only when its test is green. Do not start the next stage on a red test.

1. **Protocol is the signal.** An idle Orchestrator with no Protocol file births nothing. A Protocol file births a Wave record and does not spawn on idle alone.
   Test: `test/protocol.test.ts` — missing file, partial file, and a complete file.

2. **One pane, born once.** The Rail births the Orchestrator pane before any worker. A second Wave prompts that same pane. It does not spawn a second Orchestrator.
   Test: `test/orchestrator.test.ts` — pane id is stable across two prompts. A replaced pane fails the test.

3. **Ends, not a poll.** The Rail waits on herdr. A `done` line, a `blocked` line, and a dead pane each append one End to the trace. A heartbeat does not. Silence past the stall is one End, after one reprompt.
   Test: `test/end.test.ts` — one event per end. No event for a growing log that has no end line.

4. **The Wave closes, then one prompt.** While any pane in the Wave has no End, the Orchestrator is not prompted. When the last End lands, the Rail stores the trace pointer and the result, then prompts the same pane once.
   Test: `test/wave.test.ts` — two panes, one still open, zero prompts. Both ended, one prompt, same pane id.

5. **No live Orchestrator still finishes.** A workflow that names no Orchestrator writes the report when the Wave ends. Fan-out's existing tests stay green.
   Test: the current `runOrchestrator` report tests, unchanged in meaning.

6. **skill-rsi stands a Job up and stops.** The program calls `agentic-os run`. It does not spawn, retire, or edit the skill. The workflow names the live Orchestrator.
   Test: `skill-rsi` `pass` test — spawn count is zero in the program. The Job dir holds the Protocol path the Rail will read.
