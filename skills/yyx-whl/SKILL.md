---
name: yyx-whl
description: >-
  Use when a task fits multiple agents and the caller wants to walk
  away: independent units (fan-out) or role-playing members with their
  own briefs, models, and isolated contexts (coworker), run on the
  WhiteHartLane rail — pre-defined workflow kinds, customizable hooks and
  members, one report and one wake at the end. Triggers: "spawn a
  workflow/spur", "run this as a coworker job", "let agents do it while
  we continue", whl / WhiteHartLane / levy / spur, or status on a running
  spur (jobs / abort / continue).
---

# yyx-whl — levy a spur, never babysit it

> Source of truth for the yyx-whl skill. The yyxSkills library carries
> only a trigger stub pointing here, so this contract changes atomically
> with the door it documents — never in a second repo, a second PR.

One job: turn a bounded task into a spur — scaffold, levy with `whl run
--from`, hand back immediately. You are the **levy**: you commissioned
it, you do not coach it. Refuses: babysitting (`yyx-notify` is the
doorbell, not you), session copying, and doing the work yourself that a
spur should do.

## Commands (the door: `whl` = WhiteHartLane)

```
whl run <folder> --from <tool>:<session-id>   # levy; prints job:, log:, trace: — then STOP
                                              # (--from is REQUIRED — a Job nobody hears
                                              #  finishing is an information gap; the only
                                              #  spell without it is --unattended, chosen)
whl jobs                                       # every Job on the OS disk, one line each
whl events [sid]                               # the trace, oldest first
whl pause <jid> [--wait 2m]                    # graceful park (drains to a boundary)
whl abort <jid>                                # kill now; booked pointers survive
whl continue <jid>                             # rebirth a parked run from its sessions
whl fork <jid>                                 # deliver a booked wake into a reborn levy pane
```

The window (UI): `http://127.0.0.1:8787` — Spurs / Spur Status / Spur
Runs; the events trace pane shows every booked fact.

## Gates (ordered — a gate can end the run)

1. **Is it spur work?** Bounded task, definable done, worth ≥2 worker
   panes (fan-out: independent units; coworker: members that depend on
   each other). Interactive or one-answer work → do it yourself, STOP.
2. **Scaffold the program folder** (in the project, committed):
   `workflow.toml`, minimal template:

   ```toml
   [workflow]
   name = "my-spur"
   spur_id = "my-spur"   # set it explicitly, or it is derived with a
                         # loud warning (spur_id after ADR 0009)
   kind = "fan-out"      # or "coworker"
   slots = 2
   worker_kind = "opencode"

   [[stage]]
   id = "shards"
   topology = "fan-out"              # or solo (one briefed worker)
   preamble = "SHARED: one JSON row per file."
   units = [
     { id = "csv", brief = "Parse ONLY *.csv in data/." },
     { id = "parquet", brief = "Parse ONLY *.parquet in data/." },
   ]
   check = "bash hooks/shards-check.sh"  # optional: judges THIS stage

   [[stage]]
   id = "review"                     # roles that TALK
   topology = "coworker"
   check = "bash hooks/review-check.sh"  # the STOP CEREMONY (below)
   members = [
     { name = "qa", brief = "…", initiates = true },
     { name = "author", brief = "…" },
   ]

   [[stage]]
   id = "grade"
   topology = "gate"                 # the rail ACTS — no workforce
   run = "bash hooks/verify.sh"     # the final, deliberately cold verdict
   ```

   Author's tie-breaker (ADR 0014 — ONE authoring story, [[stage]];
   the door REFUSES `[[step]]` tables and `hooks.units`): judge a
   stage's own workforce → `check` on that stage; the rail must ACT
   (install, promote, final verify) → a `gate` stage's `run`; minds
   that must talk → coworker `members`; one mind composing probes →
   lab. NO `dag.mjs`/`spur.mjs` in a fan-out/coworker spur folder —
   the door refuses the step file (ADR 0014). Waves come free: a stage
   opens when every earlier stage settled, and fan-out units run
   parallel under `slots`.

   VERDICT TIMING (the law): **a judge that can reach its author
   MUST.** A stage `check` fires while the workforce still lives —
   solo/fan-out at each worker's finish; coworker at the exchange's
   STOP: red hands the check's stderr VERBATIM to the stop's author
   for ONE revise round, panes still up; a second red fails honestly.
   A hosted station's stop verdict is its stage check ONLY (a parent
   `[hooks]` verdict never judges a station). A gate's `run` is the
   one deliberately COLD verdict — after the chain settles; use it to
   act or for the final word, NEVER to judge a workforce you wanted
   fixable. If you are about to add a gate whose job is "check what
   the exchange produced", stop: that check belongs on the stage.
   Coworker needs `members/*.md` (or stage `members`), one brief per
   member — a brief is a prompt, write it like one. HOOKS ARE
   KIND-SCOPED: a standalone coworker runs `counts` and `verdict`
   (both real commands — `counts = "true"` once killed a run at
   report time, j-64e035); in a chain, the coworker STAGE's `check` is
   the verdict — never scaffold `units`/`grade` into a coworker toml
   and never expect a parent `[hooks]` verdict to judge a station.
   Copy a shape from this checkout:
   `examples/fan-out-spurs/staged-waves` (solo → gate → fan-out),
   `examples/chain-spurs/hand-off` (a coworker stage in a chain),
   `examples/lab-spurs/git-wave` (the lab rail). Read docs/STAGES.md
   and ADR 0014 (one authoring story) before inventing a shape.
   Every brief names its deliverable — the artifact that station
   hands back for the human to read (see Deliverables). A commission
   that never said what to read at the end still gets one: the
   guarantee is the levy's to enforce, not the commissioner's to
   remember (receipt: the whl-interview session behind
   `docs/zen/2026-10-25-zen-7.md` — four healthy levies, two full
   interviews, not one artifact the commissioner could read).
3. **Levy**: `whl run <folder> --from opencode:<your session id>` — never omit `--from`: the door refuses (a Job must wake somebody; `--unattended` is the explicit humanless exception, not the default).
   Your session id is in your own context (env/session metadata); if you
   genuinely cannot determine it, omit `--from` — the spur runs
   unattended and nobody gets the wake. Say so to the user.
4. **Hand back**: report `job:` / `trace:` lines and ONE sentence —
   "levied, I'll be woken when it ends; check the window meanwhile."
   STOP. Do not poll `whl jobs` in a loop, do not sleep-and-check, do
   not watch the log.

## Hard rules (each one fails review)

- **Never drive whl untracked.** When YOU must wait on a whl run (the
  e2e battery, the pr-review drill, any scripted levy-then-wait), run
  it in your harness's tracked background shell so its finish wakes
  you — never nohup/`&` detached. A whl-driving command you cannot
  hear finishing is an information gap you made; the operator-side
  twin of the `--from` law (receipt: pr-drill round 3, 2026-10-26 — a
  detached run finished failing and the driving session sat idle).
- **Never babysit.** No polling loops, no waiting on the orchestrator —
  the wake is the ONLY delivery. If you are a pane (a worker of another
  spur), the wake lands as a prompt in your own conversation, and your
  rail holds you in a booked wait meanwhile; if you are a chat, the
  doorbell rings; if you are gone, `whl fork <jid>` rebirths you.
  Babysitting is the exact failure mode this exists to kill.
- **Never copy a session.** `--from` books a pointer
  `{tool, session_id, since}` — the checkpoint. No snapshots, ever.
- **One wake, at the end.** Retire/abort/orphan wake you once; pause
  never does (you asked for it). Do not promise progress updates.
- **A worker is not you.** If the spur's work needs YOUR judgment
  mid-flight, the scaffold is wrong — fix the briefs, not your watch.
- **Parked ≠ broken.** paused/aborted/orphaned are parks; the human
  (or you, when asked) types `whl continue` — nothing auto-continues.
- **No deliverable, no done.** Every commission ends with ONE
  readable artifact for the human (Deliverables below) — a report of
  pointers is a failed report, whatever the brief said or forgot.

## Deliverables (every commission ends with something to read)

Whatever the task, the human ends holding one readable artifact — a
diagram, an HTML page, a PNG — never a bare pointer. The taste is
FIXED (stated reading preference; the worker re-derives nothing):

| tier      | shape | when |
| --------- | ----- | ---- |
| default   | Mermaid `flowchart` (structure, topology) and/or `sequenceDiagram` (ordering, interaction) in the report itself | every report — real names, real numbers, one diagram answers one question |
| html      | one focused HTML artifact, product-matching type and spacing, opened with `open` | the point needs density or interaction a diagram cannot carry |
| showcase  | one yyx-terminal-diagrams PNG (2x, filed under `~/Pictures/term-diagrams/`) | the artifact IS the product — a walkthrough to forward, a team-facing explainer. Costly: one per commission, earned by the ask, never the default |
| plain     | pseudocode / diff / table | the point is logic or a change, not a shape |

Failed deliverables: unstyled HTML the user must tune, prose walls,
pointer-only reports. Deeper reading preferences: `~/wiki/language/`
(read the index first).

## Output contract

The hand-back is exactly: the door's `job:`/`log:`/`trace:` lines, the
spur id (`project/spur_id`), and the one-sentence hand-off. Later, when
the wake arrives, relay `wake.json`'s message + report path verbatim,
then name the deliverable: what to open, one line on what it shows. If
the report carries no artifact, render the deliverable yourself from
the report before handing over — a gap you forward is a gap you made;
the missing requirement goes into the next spawn's briefs.
If the wake (message or report) surfaces a defect in whl/WhiteHartLane
itself — a contract programs keep re-tripping (heartbeat path ambiguity,
hook stdout purity, run-dir vs source-dir) — file one issue per defect
on yyx462/whitehartlane (symptom / root cause / job id / run-dir pointer)
and say so. Run-scoped workarounds (program-folder briefs, hooks) are
the spur's to make; an OS fix is a ticket, never a mid-run edit of
WhiteHartLane or this skill.

## The PR review hook (every PR-generating stage's tail)

`whl review` — the adversarial pre-merge rail. The agent-facing
contract is the USER-level skill **yyx-ship** (the ship gate: spell,
verdict handling, feedback division, test adoption, the re-levy law)
— load it when reviewing. The door-shipped manual is
`whl review --help`; the deep shape is `templates/pr-review/README.md`
(economics: its ECONOMICS.md). One law for this manual: a dead unit
re-levies the SAME program dir, never a fresh materialization.

## Stop

Levied and handed back → STOP. The next event in this session is the
wake (or the user asking for status: `whl jobs` once, answer, STOP).
