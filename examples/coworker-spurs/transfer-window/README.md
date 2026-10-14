# transfer-window — the summer-2026 demo spur

A two-level demo that re-enacts the REAL August 2026 window, as a
shootable video script and a runnable program folder.

- **Reality**: Spurs signed Sávio from Man City on 2026-08-25 for
  £75m + £10m add-ons, after City beat them to Ndiaye (deadline day,
  £60m + £5m) and Gakpo's wages priced him out (Barcola's £120m move
  to Liverpool made him available; the wage demand was the wall).
  The briefs carry those numbers verbatim.
- **Shape**: `transfer-window` (coworker: coach → scout → finance)
  whose finance member levies `negotiation-room/` (coworker:
  negotiator-ndiaye, negotiator-savio, negotiator-gakpo share tab 1;
  professor overflows to his own tab and decides by the board's
  gates) — spurs nest end-to-end, finance holds a booked wait, the
  room's wake lands back in finance's pane.
- **The script, shot list, style guide and capture recipes** live in
  `docs/demo/transfer-window-video.md`.

## Running it

Happy path (the chairman's levy, from inside an opencode pane in
herdr whose cwd is this folder):

    whl run . --from opencode:$(opencode session list -n 1 | head -1 | cut -f1)

Smoke (no wake):

    whl run . --unattended

The room alone:

    whl run negotiation-room --unattended

## The failure take

    cd negotiation-room
    cp workflow.broken.toml workflow.toml     # poison the Sávio desk
    whl run . --from opencode:$(opencode session list -n 1 | head -1 | cut -f1)

The Sávio pane fails every call behind the opencode-go gate (a real
API error, no mock): `An active OpenCode Go subscription is required
to use Go models.` The rail retries, nudges, chases — and when the
operator is satisfied the desk is dead weight, ABORT (UI button or
`whl abort <jid>`). Booked pointers survive.

**The fix goes in the RUN-DIR manifest**, not this folder —
`whl continue` re-reads the staged copy at
`<session>/jobs/<jid>/run/workflow.toml` (the run is identified by
the content hash it was booked with; the source stays honest). Change
one line:

    [members.negotiator-savio]
    model = "opencode-go/glm-5.3"          →  "zhipuai-coding-plan/glm-5.3-flash"

then Continue (UI button or `whl continue <jid>`). Every member
respawns resumed from its booked session — no re-brief, delivered
mail never re-sent; only the Sávio desk actually works, then the
professor wakes with all three offers and signs.

## Why the room is a coworker, not a lab/fan-out

The professor + three students shape is the lab rail's native shape,
but the failure take needs ONE poisoned desk — and per-member model
pinning (`[members.X].model`) exists only in coworker. Coworker it
is; the lane law (max 3 lanes/tab) is why the professor gets his own
tab — the students share the room, the decider sits in his office.
