# TASK — P0 review telemetry (PR 1 of the economics+prevention plan)

## Mission
The rail measures its own spend: per-unit token aggregates land in the
run's own artifacts (units.jsonl / table.json) at unit settle, so `whl
jobs` can print economics natively — no more DB archaeology via
scripts/review-trace.mjs. Receipt: ECONOMICS.md proposal #2.6.

## Seam (one mechanism)
Recording usage where unit results already settle. NOT: changing lens
briefs, verdicts, or the decision model.

## Plan context (session ses_e59f4aa8dffetDCbPOZcbh90lP, 2026-11-05)
- Diagnosed: 130 review runs, 5 accepts, 71.3h, 104.7M input, 31% waste,
  39 dup keys (review.ts:INV-3 x30). Plan = P0 telemetry → P1 INTENT pack
  → P2 pre-flight receipt → P3 one-seam → P4 questions fold-in → P5
  tests-at-authoring. THIS worktree = P0 only (one seam per PR).
- Already shipped elsewhere (do not re-do): delta rounds (review.ts:1169),
  [stop] rule, born_ms, deadline_s, model ladder.

## Verification lane
- npm install INSIDE this worktree first (gwt guard).
- Single-file: `npm run test:one -- <file>` (sweep-on-exit guard).
- Full: `npm test`. Then `gwt verify` before submit.
- Submit: `gwt submit-pr "<title>" "<body>"`, then yyx-ship spell
  (tracked background shell) for the review levy.

## Status log
- [x] locate seam: cycle()'s finish() (orchestrator.ts:616) — every unit finish flows through it
- [x] implement usage capture at settle: CycleDeps.usageOf seam + engine wiring to rail.usageOf (#104)
- [x] surface in `whl jobs`: sumUnitTokens fold (trace.ts) + tok column (bin/whitehartlane)
- [x] tests (writer≡reader round-trip: test/unit-tokens.test.ts, 4 pass)
- [x] npm test 999 pass / 0 fail / 2 pre-existing skips
- [ ] gwt verify + submit + review levy
- Follow-up P1 (INTENT pack) is a SEPARATE PR — do not add here (one seam).
