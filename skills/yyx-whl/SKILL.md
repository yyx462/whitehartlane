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
                         # loud warning (spur_id after ADR 0009; legacy
                         # dag_id still reads, also with a warning)
   kind = "fan-out"      # or "coworker"
   slots = 2

   [hooks]
   units = "true"                    # steps define the units (ADR 0007)
   grade = "bash hooks/grade.sh"
   counts = "bash hooks/counts.sh"

   [[step]]
   id = "g0"
   finished_by = "end"               # a worker pane runs the step brief
   wave = "w1"

   [[step]]
   id = "merged"
   finished_by = "check"             # a command exits 0 — nothing works
   check = "gh pr view g0-shared --json state | grep -q MERGED"
   wave = "w2"

   [[step]]
   id = "child"
   finished_by = "wake"              # a declared child program's receipt
   folder = "./child-spur"
   wave = "w3"
   ```

   Author's tie-breaker (ADR 0007): a deterministic sync check →
   `check`; needs judgment → `end` (the brief says "verify and append
   done/blocked"); a declared child program → `wake`. Waves are
   grouping properties: a wave opens when every earlier wave finished,
   and `end` steps within a wave run parallel under `slots`.
   NO `dag.mjs`/`spur.mjs` in a fan-out/coworker spur folder — a
   program file present makes it a LAB spur (a different rail).
   Coworker needs `members/*.md`, one brief per member — a brief is a
   prompt, write it like one. HOOKS ARE KIND-SCOPED: a coworker runs
   ONLY `counts` (a real JSON-printing command — `counts = "true"` once
   killed a run at report time, j-64e035); `units`/`grade` are
   fan-out/lab concepts and are ignored — never scaffold them into a
   coworker toml. Copy a shape from this checkout:
   `examples/fan-out-spurs/staged-waves` (waves + a check),
   `examples/fan-out-spurs/nested-wakes` (wake steps),
   `examples/coworker-spurs/steps-viz` (coworker),
   `examples/lab-spurs/lab-program` (the lab rail). Read ADR 0007
   (typed steps) and ADR 0009 (spur spelling) before inventing a shape.
3. **Levy**: `whl run <folder> --from opencode:<your session id>` — never omit `--from`: the door refuses (a Job must wake somebody; `--unattended` is the explicit humanless exception, not the default).
   Your session id is in your own context (env/session metadata); if you
   genuinely cannot determine it, omit `--from` — the spur runs
   unattended and nobody gets the wake. Say so to the user.
4. **Hand back**: report `job:` / `trace:` lines and ONE sentence —
   "levied, I'll be woken when it ends; check the window meanwhile."
   STOP. Do not poll `whl jobs` in a loop, do not sleep-and-check, do
   not watch the log.

## Hard rules (each one fails review)

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

## Output contract

The hand-back is exactly: the door's `job:`/`log:`/`trace:` lines, the
spur id (`project/spur_id`), and the one-sentence hand-off. Later, when
the wake arrives, relay `wake.json`'s message + report path verbatim.
If the wake (message or report) surfaces a defect in whl/WhiteHartLane
itself — a contract programs keep re-tripping (heartbeat path ambiguity,
hook stdout purity, run-dir vs source-dir) — file one issue per defect
on yyx462/whitehartlane (symptom / root cause / job id / run-dir pointer)
and say so. Run-scoped workarounds (program-folder briefs, hooks) are
the spur's to make; an OS fix is a ticket, never a mid-run edit of
WhiteHartLane or this skill.

## Stop

Levied and handed back → STOP. The next event in this session is the
wake (or the user asking for status: `whl jobs` once, answer, STOP).
