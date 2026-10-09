# ADR 0006 — whl wake and fork: the levy is never the babysitter

Date: 2026-10-09 · Status: accepted (wake, checkpoint, fork, and booked
wait implemented; the doorbell demoted to fallback)

## Context

A levy (any main agent session) stands a spur up with `whl run`.
The orchestrator is already detached — the door daemonizes it and exits,
so the levy is free. What is missing is the other half of the contract:
the spur must tell the levy when it is done ("spur for task X done —
report at …"), exactly once, and it must survive the levy being gone
(pane closed, session ended) — the queued message waits until a reborn
levy can read it. And because a levy may itself be a worker of another
spur (spurs nest), the wake must reach a *pane* levy in-band — a
Telegram DM to the person is the wrong recipient for a pane's business
— and the waiting pane's own rail must not read its idle as a stall.

## Decision

1. **Checkpoint at spawn.** `whl run <folder> --from <tool>:<session-id>`
   records `spawner: {tool, session_id, since}` (the levy pointer) on the
   Job; `since` is the spawn moment. This pointer IS the checkpoint — a point in the
   levy's own transcript, never a copy of it (glossary law: transcripts
   are pointers; avoid "snapshot"). Without `--from`, nothing changes:
   the Job is unattended, no wake is ever booked.
2. **Wake at the end, once.** When a Job with a spawner parks or
   retires — retire, abort, orphan; NOT pause (the pauser asked for it,
   it knows) — the rail books the wake:
   - `wake.json` on the job dir: `{to: spawner, jid, task, outcome,
     message, report, at}` — the durable record;
   - one `job.woke` event on the trace (carrying the delivery);
   - `woke` on the Job record — the once-guard.
   Delivery is layered, in order:
   - **in-band**: if a live pane of a running Job holds the spawner's
     host session (a pane levy — spurs nest), the rail prompts that
     pane with the wake message (`herdr agent prompt`); the wake lands
     in the levy's conversation;
   - **doorbell (fallback)**: only when no live pane took the wake —
     the levy is a chat a person holds, or the pane could not be
     prompted — a best-effort ring through the machine's `notify` CLI
     (`AGENTIC_OS_NOTIFY=0` disables, absence disables); a failed
     doorbell never fails the booking;
   - **queued**: the durable record waits for `whl fork`.
3. **Fork, the rebirth.** `whl fork <jid>`: with a wake booked and the
   levy pane gone (or whenever the human types it), spawn a new pane
   seeded `{tool, session_id, since: spawner.since}` — the levy's host
   session resumed from the checkpoint, the wake message as the pane's
   first prompt. The pane is born on the levy's session trace
   (`pane.born` with the seed and `fork_of`), never shep-recorded into
   the spur's Job; the spur records `wake.consumed`. Admission is the
   fork law (zen 6): known tool, and the seed must resolve — pi by
   header id, opencode by db row. The levy session stays the spawn point
   forever; the fork only ever points back to `since`.
4. **Booked wait.** A pane whose booked session a running Job names as
   its spawner is idle for a reason: its child spur holds the ball.
   The rails consult `liveSpawnerSessionIds()` before reading silence
   as failure — fan-out's stall settle stands down (the clock restarts
   each time the wait is seen), coworker's ball nudges stand down
   (without spending a nudge). The wait clears the moment the child
   parks or retires — pause included, by design: pausing a child its
   parent waits on is a deliberate break, and the parent's rail makes
   it visible. The run deadline still bounds everything.

## Consequences

- The levy spawns, walks away, and gets exactly one ping — babysitting is
  structurally opt-out, not discipline.
- Spurs nest end-to-end: a worker pane levies, waits in a booked wait
  its own rail honors, and takes the wake as a prompt in its own
  conversation when the child ends.
- Delivery degrades gracefully: pane live → in-band prompt; person's
  chat → doorbell; pane gone → wake.json waits, `whl fork` delivers it
  into a reborn session.
- The Telegram doorbell is a fallback, not the design: panes never
  route their business through the person's pocket.
- The trace gains `job.woke` (with delivery), `wake.consumed`, and
  levy-side `pane.born` records carrying seeds; the window shows them.
- Nothing is copied, nothing is deleted; a wake is a booked fact on
  records the OS already owns.
