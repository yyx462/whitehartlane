# ADR 0008 — the in-band wake spool

Date: 2026-10-11 · Status: accepted

## Context

ADR 0006 defined the end-of-job wake with a delivery ladder: an
in-band prompt to a live pane holding the levy's session, the machine
doorbell as fallback, the durable `wake.json` waiting for `whl fork`.
PR #57 made every `whl run --from opencode:<sid>` book a **chat levy**
— the main agent's own conversation — and a chat is not a pane: rung 1
cannot apply, so main agents learned of their spurs only through the
human-relayed doorbell (or by polling, which ADR 0006 forbids).
j-45a9fa proved the gap end to end: `delivery: "queued"`, nobody told.

Meanwhile the yyx-shep prototype's wake channel had already proved the
missing rung in production: a filesystem queue plus a plugin riding
the opencode process itself, delivering rows as **real user-role
turns** via `client.session.promptAsync`. shep is a prototype this
product replaces — its mechanism is worth taking, its dependency is
not, and its single shared queue with an owner-claim (first opencode
process to touch a `shep ` command wins, 15-minute stale window) is a
race we do not need: agentic-os already holds the exact address — the
booked spawner pointer's `session_id`.

## Decision

The wake spool: a per-session filesystem queue on the OS disk, one
JSON line per wake, written by the rail and drained by an
agentic-os-owned opencode plugin.

- **Addressing by pointer, not by claim.**
  `<os-home>/wake-spool/<session-id>/queue.jsonl`. The booked spawner
  pointer IS the address; no claim file, no owner race, no wrong
  session can ever take a wake.
- **The reader is the plugin** (`plugin/opencode-wake.js`, installed
  by `whl plugin install` as a symlink — git pull updates it, no
  second source to drift). Membership: the levy session always runs
  `whl run` in the very turn that books it, so a bash command matching
  `whl|agentic-os` is the zero-config mark. Triggers: fs.watch
  (writer-side, ~100ms), session.idle (turn end), a 30s tick backstop.
- **Proof-of-life gates the rung.** The plugin heartbeats
  `alive.json` per session; `wakeFirstMate` takes the in-band rung
  only when the heartbeat is fresh (< 15 min) — otherwise the ladder
  falls to the doorbell exactly as before. Nothing is trusted blindly:
  a dead plugin degrades to the pre-ADR behavior.
- **At-least-once.** The byte-offset watermark advances only after
  `promptAsync` accepts; a crash in between redelivers the same
  digest. Torn tails (crash mid-append) wait for their newline;
  malformed lines are consumed and skipped — one bad byte cannot wedge
  the queue.
- **The ladder order becomes**: pane prompt → in-band spool (opencode
  levy, fresh heartbeat) → doorbell → durable `queued`. A rail
  spawner is never spooled nor doorbelled (ADR 0007: it polls
  `wake.json` — a machine is not a conversation).

## Consequences

- A main-agent levy gets its wake as a turn in its own conversation —
  the ADR 0006 contract finally holds for chats, not only panes.
- Scope: same-machine levies only (the plugin reads the local OS
  disk). Remote or resumed-elsewhere levies degrade to doorbell +
  durable queue + `whl fork` — the "ultra stranger" path stays
  defined and honest.
- `wake-spool/` joins the OS disk layout; sessions without levies
  write nothing there (heartbeat only for door-touching sessions).
- The shep wake queue is NOT wired into the rail and can retire.
