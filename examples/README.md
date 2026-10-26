# examples — the stage-chain corpus

Every chain-shaped program here is authored in the one dialect
(ADR 0014 / docs/STAGES.md): a `workflow.toml` of `[[stage]]` entries —
table order is execution order. The retired spellings (`[[step]]`
tables, the `hooks.units` quick-mint, the `[gates]` detector table, the
`spur.mjs`/`dag.mjs` step file) are refused at parse or at the door.

| example | shape it teaches |
|---|---|
| `fan-out-spurs/nested-wakes` | a solo stage, then a coworker stage — hosted in-process at its station (ADR 0016), no child job, no mint |
| `fan-out-spurs/staged-waves` | solo → gate (`run`) → fan-out (`units`), the chain in miniature |
| `fan-out-spurs/two-signoffs` | one work stage, then two gate stages (the old `[gates]` as one-shot rail verdicts) |
| `chain-spurs/hand-off` | draft, then a two-member coworker stage hosted at its station |
| `lab-spurs/git-wave` | a lab stage: the actor composes waves; a custom inline `end` detector |
| `lab-spurs/trivia-bench` | a lab stage as an eval harness: rounds, actor-graded scorecard, model swap |
| `coworker-spurs/pause-fixture` | a pure exchange in its native shape (`kind = "coworker"`, `[members.*]`) — the shape a coworker stage hosts; pause/continue smoke fixture |
| `coworker-spurs/transfer-window` | **STALE — do not copy** (pre-stage shape: hand-levied child, no stop ceremony; rewrite pending — the modern case is `test/e2e/transfer-window-v2/`) |

A coworker stage's `check` is the STOP CEREMONY — it runs at the
exchange's stop, before any member pane retires (one revise round on
red; docs/STAGES.md). The worked case lives at
`test/e2e/transfer-window-v2/` (its `accept-plan.sh` both judges and
promotes).

The fan-out fixture the test suite runs (`test/util.ts`'s `EXAMPLE`) is
`test/fixtures/three-lookups` — the converted form of the retired
units-hook example.

Not an example but a RAIL: `templates/pr-review/` — the adversarial
pre-merge review program (`whl review <repo> --base … --head …`; the
PR→merge gate with 4 lenses, a mechanical proof gate, and per-worker
feedback division). Its drill: `PR_DRILL=1
test/e2e/pr-review/run-drill.sh <this checkout>`.
