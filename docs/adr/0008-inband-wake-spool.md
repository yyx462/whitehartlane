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
- **The levy pane — registration (rung 2).** The levy's own chat may
  live inside a herdr pane (herdr detects agent panes it never
  started, any supported kind). `whl register --from opencode:<sid>`
  run inside that pane books the one binding herdr cannot know —
  which host session lives in which pane — on the OS disk
  (`levy-panes/<sid>.json`). HERDR_PANE_ID is the address, `herdr
  agent get <pane>` the aliveness oracle, `herdr agent prompt <pane>`
  the injection — tool-independent. Renewal-by-presence: any door
  command run in a registered pane re-touches it. Registration is
  voluntary by definition: the OS never claims a pane uninvited, and
  `audit` admits registered panes by their registration.
- **The fork rung (rung 3) — the owner's rule.** A chat levy that
  never registered is DEAD to the ladder, even if a process holds it:
  registration is the only aliveness claim that outranks the fork.
  The wake rebirths the levy into a fresh pane (the `whl fork` body:
  session resumed from the checkpoint, wake as the first prompt) and
  books the consumption. Honest caveat, accepted: the unregistered
  original may still be alive — the fork becomes the levy's live
  incarnation and the original stays ignorant; register to not be
  reborn. Disarmed by `AGENTIC_OS_FORK_WAKE=0` (herdr-less hosts).
- **The spool is opt-in (rung 4), never auto-installed.** The plugin
  is installed only by an explicit `whl plugin install`; `whl plugin
  uninstall` removes it. It serves hosts where the levy's chat does
  NOT live in herdr — on the owner's machine the fork covers that
  case, so the plugin stays uninstalled. A fresh spool heartbeat does
  NOT outrank the fork — deliberately.
- **The ladder order becomes**: worker pane → registered levy pane →
  fork → spool → doorbell → durable `queued`. A rail spawner is never
  prompted, forked, spooled nor doorbelled (ADR 0007: it polls
  `wake.json` — a machine is not a conversation).

## Why two in-band rungs (the semantic division)

The pane relay (rung 1) and the spool (rung 1.5) are one ladder over
**disjoint levy kinds**, not two systems:

- A **pane levy** is a worker of a running Job (nested spurs — the
  machine phase: no human, rails-owned lifecycle). The pane ledger is
  the deterministic aliveness proof, and `herdr agent prompt` does
  more than deliver text — it unblocks a stalled agent turn, which a
  file row cannot.
- A **chat levy** is the main agent's own conversation (the
  interactive phase). It has no pane and no label — only the booked
  session pointer — and only an in-process plugin can inject a turn
  there. Its aliveness proof is the heartbeat; its "accidentally
  closed" recovery is the ladder's floor: doorbell, durable
  `wake.json`, and `whl fork` rebirth (session seed re-checked, pane
  resumed, wake as first prompt — ADR 0006 §3).

Neither rung can subsume the other: the plugin cannot reach a pi pane
or unblock a stall; herdr cannot prompt a conversation that is not a
pane.

## Per-tool readers, one contract

Only the reader half is host-tool-specific. The spool contract (dir
layout, jsonl rows, alive.json heartbeat, byte-offset semantics) is
tool-agnostic; each coding agent gets its own reader under
`plugin/<tool>-wake.js`, installed by `whl plugin install` for the
tools present. opencode ships now (our chats are opencode); pi is the
next reader when a pi chat levy exists — pi *worker panes* need
nothing, the pane relay already covers any tool running in a pane.

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
