# ADR 0006 — whl wake and fork: the First Mate is never the babysitter

Date: 2026-10-09 · Status: accepted (wake + checkpoint implemented; fork contracted)

## Context

A First Mate (the main agent session) stands a spur up with `whl run`.
The orchestrator is already detached — the door daemonizes it and exits,
so the FM is free. What is missing is the other half of the contract:
the spur must tell the FM when it is done ("spur for task X done —
report at …"), exactly once, and it must survive the FM being gone
(pane closed, session ended) — the queued message waits until a reborn
FM can read it.

## Decision

1. **Checkpoint at spawn.** `whl run <folder> --from <tool>:<session-id>`
   records `spawner: {tool, session_id, since}` on the Job; `since` is
   the spawn moment. This pointer IS the checkpoint — a point in the
   FM's own transcript, never a copy of it (glossary law: transcripts
   are pointers; avoid "snapshot"). Without `--from`, nothing changes:
   the Job is unattended, no wake is ever booked.
2. **Wake at the end, once.** When a Job with a spawner parks or
   retires — retire, abort, orphan; NOT pause (the pauser asked for it,
   it knows) — the rail books the wake:
   - `wake.json` on the job dir: `{to: spawner, jid, task, outcome,
     message, report, at}` — the durable record;
   - one `job.woke` event on the trace;
   - `woke` on the Job record — the once-guard.
   - a best-effort doorbell through the machine's `notify` CLI
     (`AGENTIC_OS_NOTIFY=0` disables, absence disables); a failed
     doorbell never fails the booking. Layered delivery: durable
     record → doorbell → (later) rebirth.
3. **Fork, the rebirth (contracted, next slice).** `whl fork <jid>`:
   when the FM pane is gone, spawn a new pane seeded
   `{tool, session_id, since: spawner.since}` — the Fork machinery
   already specced for panes, pointed at the FM itself — with the wake
   message as its first prompt. The FM session stays the spawn point
   forever; the fork only ever points back to `since`.

## Consequences

- The FM spawns, walks away, and gets exactly one ping — babysitting is
  structurally opt-out, not discipline.
- Delivery degrades gracefully: pane alive → doorbell suffices; pane
  gone → wake.json waits, `whl fork` delivers it into a reborn session.
- The trace gains `job.woke`; the window shows it (receipt + events).
- Nothing is copied, nothing is deleted; a wake is a booked fact on
  records the OS already owns.
