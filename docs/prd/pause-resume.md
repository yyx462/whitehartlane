# Pause & Continue — Jobs that park and resume

For long runs (agentic scraping, coding Jobs), a Job must park without
losing work-in-progress and resume without redoing it. Pause and abort
both retire panes; they differ only in where the boundary lands.
Continue rebirths panes from booked session pointers — the pane is a
terminal, the host session is the state.

## Picture

```text
running ── pause (SIGTERM) ──> drain to boundary ──book──> paused
running ── abort (SIGKILL) ──> park now ────────────────> aborted
crash / reboot / unbooked ──sweep──> orphaned
                                                        │
paused | aborted | orphaned ── continue (typed) ─────────┴──> running
   retire stragglers; respawn panes, host sessions resumed;
   rail prompts "continue"; orchestrator rebuilds from the pane ledger
```

## Law

- Every pane is born booked — with its host session pointer. The
  booking is write-ahead: it lands at spawn, before work starts, so
  even a SIGKILLed orchestrator leaves a resumable Job.
- Pause and abort both retire panes. The difference is the checkpoint
  boundary, nothing else.
- Settling stays the single booking point (`done <id>` →
  `state.json`). Unit quality is the grade hook's job; the rail never
  judges content, and no unit dir is cleaned up by the rail.
- The resumed agent is the verifier: its transcript already knows what
  it wrote.
- Nothing auto-continues. A parked Job waits for a person.

## Boundaries

- **fan-out**: drain = take no new unit claims; every in-flight unit
  finishes (existing event loop already converges; a `draining` flag
  stops new spawns and exits when `inFlight` is empty).
- **coworker**: drain = the relay stops delivering; a member mid-turn
  ends its turn (writes mail or goes idle). Pending undelivered mail
  is *not* drained — it waits in `messages/`, delivered by the next
  run per the delivery ledger.
- **ceiling**: `drain_timeout_ms` under `[workflow]` in `workflow.toml`
  (default: the stall timeout, 10m; env `AGENTIC_OS_DRAIN_MS` overrides);
  `pause --wait 2m` writes a one-shot deadline. Past the ceiling the
  straggler is aborted (session kept, unit left open); the park still
  happens.

## Continue, mechanically

1. Retire stragglers of the old generation (the absorbed relaunch
   machinery, `bin/agentic-os` continue path).
2. For each pane record with unfinished work: respawn via shep with
   the host session resumed from `{tool, session_id}`; the rail
   prompts `continue` (+ worktree/folder path context). A member
   interrupted mid-turn gets one nudge: "you were interrupted
   mid-thought; continue" — rail-generated, never member-authored.
3. The orchestrator rebuilds its in-flight table from the pane
   ledger (pane records carry the unit binding); the relay gates
   redelivery on `relay.json`.
4. Book `running`; `jobs` shows a `continued ×N` counter (soft, never
   a hard cap).

## Resume strategy

- Default **resume-session** — the reborn pane continues its own
  unit from its own transcript; partial unit dirs stay, the resumed
  session completes its write in place.
- Optional **redo-unit** per workflow (`resume = "redo-unit"` in
  `workflow.toml`): in-flight units requeue fresh, the prior attempt
  archived to `units/<id>/.attempt-1/` for traceability.

## Milestones

- **M1** fan-out: `paused` state, `pause`/`continue` verbs, SIGTERM =
  drain, session_id in the pane transcript pointer, drain ceiling.
- **M2** coworker: persist `delivered[]` as `relay.json` in the Job
  dir (write-ahead per delivery), interrupted-turn nudge, coworker
  drain boundary.
- **M3** verb consolidation: `relaunch` absorbed into `continue`
  (same straggler-retire + respawn code path), RELAUNCH_CAP dropped
  for the soft counter.
