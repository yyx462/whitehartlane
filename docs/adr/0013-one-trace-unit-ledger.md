# One Trace: the unit ledger rides the OS-disk events

## Decision (2026-10-20, OPTIMUM §8 — the events fold #162 named)

The task dir's `checkpoints.jsonl` is retired as a store. Every ledger
card is a `unit.card` event on the task dir's owning session trace
(`sessions/<sid>/events.jsonl`, store.ts — zen 2's law: the trace is
the source, every projection is derived). The task dir keeps only the
delivery interface (briefs, `units.jsonl`, `report.json`, `wake.json`,
`orchestrator.log`); a run's lifecycle state lives in exactly one
place, beside the job it belongs to.

Considered and rejected: keeping `checkpoints.jsonl` as a trace
projection rewritten per card (rejected — the same two files plus
re-derivation machinery; nothing deletes, the duplicate-store drift
survives); folding the cards into the existing `unit.finished` events
(rejected — `info` cards observe and never finish anything, and the
report-row channel and the lifecycle fold are different facts about
the same moment; one kind per fold).

The seam holds: `checkpoint`/`settle`/`readState`/`readCheckpoints`
keep their signatures, and the five readers (orchestrator,
orchestrator-chain, front-door, rail, resume) are untouched. Inside
the seam:

- **The join** is `findJobByDir` — deterministic (oldest job owning the
  dir), memoized per process, so the orchestrator mid-run, a later
  regrade, and a rerun's fresh booking all resolve the SAME trace; a
  rerun's cards fold in beside the original run's exactly as they did
  when one file accumulated them. Events key the fold on `dir`, not
  `jid`, for the same reason.
- **A jobless dir mints its record at the first card, never on a
  read.** A dir that settles units is a run; runs leave records. The
  front door's in-process grading (and fixtures) thereby stop being
  invisible to the OS disk. Reads (`readState` on an unknown dir)
  write nothing.
- **Legacy spellings stay read-only for one release** — the
  state.json pattern (#162): a pre-fold `checkpoints.jsonl` folds
  strictly before the trace's cards (it is strictly older) and is
  never appended to; `state.json` still wins its own read wholesale.
- `store.readEvents` now skips a torn tail line instead of throwing:
  `readState` rides it on the orchestrator's every cycle, and one
  partial line must not brick a live run's state read.

## Consequences

- `whl` runs no longer write the task-dir ledger; `regrade` re-enters
  at the failed card exactly as before (#144 semantics unchanged —
  the fold order and last-card-wins rule are byte-identical).
- Two readers outside this fold's blast set still fold the retired
  file and must mirror the trace (the §7 follower-churn pattern —
  #145, #162 did the same in-flight; this slice's scope law left them
  out): `web/server.mjs` `stepStatesOf` (chain-graph finish coloring
  for NEW runs; legacy dirs keep their files) and `bin/whitehartlane`
  `unitsOf`'s existence guard (the `whl jobs` units column reads blank
  until that guard drops). `docs/RAILS.md`'s ledger wording follows.
