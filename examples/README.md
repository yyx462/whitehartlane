# examples — the stage-chain corpus

Every chain-shaped program here is authored in the one dialect
(ADR 0014 / docs/STAGES.md): a `workflow.toml` of `[[stage]]` entries —
table order is execution order. The retired spellings (`[[step]]`
tables, the `hooks.units` quick-mint, the `[gates]` detector table, the
`spur.mjs`/`dag.mjs` step file) are refused at parse or at the door.

| example | shape it teaches |
|---|---|
| `fan-out-spurs/nested-waves` | a solo stage, then a delegated exchange (coworker stage → minted child, wake settles the link) |
| `fan-out-spurs/staged-waves` | solo → gate (`run`) → fan-out (`units`), the chain in miniature |
| `fan-out-spurs/two-signoffs` | one work stage, then two gate stages (the old `[gates]` as one-shot rail verdicts) |
| `chain-spurs/hand-off` | draft, then a two-member exchange minted as a whole child program |
| `lab-spurs/git-wave` | a lab stage: the actor composes waves; a custom inline `end` detector |
| `lab-spurs/trivia-bench` | a lab stage as an eval harness: rounds, actor-graded scorecard, model swap |
| `coworker-spurs/pause-fixture` | a pure exchange in its native shape (`kind = "coworker"`, `[members.*]`) — the shape a coworker stage mints; pause/continue smoke fixture |
| `coworker-spurs/transfer-window` | the summer-2026 demo: a three-member exchange whose finance desk levies the `negotiation-room/` child + `workflow.broken.toml` failure take |

The fan-out fixture the test suite runs (`test/util.ts`'s `EXAMPLE`) is
`test/fixtures/three-lookups` — the converted form of the retired
units-hook example.
