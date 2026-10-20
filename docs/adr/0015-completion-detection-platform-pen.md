# ADR 0015 — completion-detection: the platform pen

Date: 2026-10-20 · Status: accepted (status-first lane landed; event-wake follow-up pending)

## Context

Iteration 4 of RSI-LOOP-V2 (2026-10-20, j-698ce6): a fixer finished or
died silently — either way the log stayed empty, and the only completion
detector was the worker's own typed marker. Ten quiet minutes later the
stall ladder ruled `stalled`, a possibly-finished worker was convicted
of silence, and the retry restarted from zero (40 min lost). The marker
made the agent's memory load-bearing; the platform knew better and was
not asked (herdr's `agent_status` was already a witness, j-964391, but
only as a stall ACQUITTAL — never as a completion trigger).

## Decision

1. `workflow.settle_mode = "status-first"` (default `"marker"`, which
   is byte-identical to every prior run) arms the platform pen: a pane
   whose harness status is `idle` (or `done`) settles on the
   deliverable itself — `probeDeliverable` judges SHAPE only (result.md
   present, non-empty); semantics stay at the stage gate. The card
   carries `trigger: "idle+grade"` so a fold can prove the settle was
   status-driven, never timer-driven.
2. A missing deliverable at idle is an EVIDENCE reprompt: the note
   quotes the failing check and names the artifact (never a plea —
   Claude Code #55754's bill). Hard cap 8 (`SETTLE_ATTEMPT_CAP`); past
   the cap the unit ends stalled-with-evidence, the trace quoting the
   check — bounded, never infinite.
3. The wait-for DAG is receipt-backed: `WakeBooking` gains `parentUnit`
   and `spawnerSession` (meaning in the names; self-contained
   receipts). An idle parent with a live booked child (no `wake.json`
   yet) waits by design — `waitingOnLiveChild` folds dangling edges to
   "not a wait". The graph is acyclic by birth (every levy mints a
   fresh child), so there is no cycle machinery.
4. `workflow.fallback_ladder = false` suppresses the passive stall
   verdict (the status-first trial window: the old killer must not
   fire while the new lane is proven). Unknown-status panes keep the
   ladder when it is on.
5. `briefFor` in status-first mode asks for the artifact and a plain
   stop — the `blocked` escape hatch (the worker's other pen) survives
   in BOTH modes.

## Consequences

The marker demotes to the fallback lane (status-blind panes and the
byte-identical default). `unit.grade` becomes a trace event (the
evidence before the ruling); the finish ceremony stays one spelling —
card + `unit.finished` + report row. Declared follow-up: the
event-driven wake (`herdr agent wait --until idle`) so the settle fires
on the transition instead of the next beat — the ladder settles on any
wake today, promptness rides the cadence.
