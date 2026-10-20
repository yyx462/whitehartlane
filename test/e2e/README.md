# e2e battery — real-run mechanism tests

Real stage programs (not unit tests): each is a workflow levied through the
actual door, with real opencode workers, real dialogs, real wakes. Run them
when you want to know whether the SYSTEM works, not whether the functions
pass. Costs real agent turns — a full pass is ~20 minutes and a handful of
tokens.

Every scenario is authored in the one dialect (ADR 0014): a `[[stage]]`
chain. Worker briefs live inline in the stage tables (the rail appends the
done/blocked log protocol itself); grade/counts hooks stay at `[hooks]`.

## Fixtures (once, before running)

```bash
mkdir -p ~/e2e-shots && printf 'fakepng-bytes' > ~/e2e-shots/shot.png   # shots target (gray zone)
mkdir -p ~/e2e-vault && printf 'FAKE_TOKEN=not-a-real-secret\n' > ~/e2e-vault/.env  # secrets target (hard deny)
mkdir -p /tmp/e2e-battery/out                                            # smoke/waves/longsilent/nested targets
```

## Running

One scenario (from its dir, so each gets its own session):

```bash
cd test/e2e/smoke && <repo>/bin/whl run . --from opencode:<your-session-id>
```

All of them, sequentially (safer than concurrent — see #78):

```bash
test/e2e/run-battery.sh <repo-checkout> opencode:<your-session-id>
```

Babysit: `whl jobs` once per minute; every job should end with a wake INTO
YOUR PANE (in-band), not a fork.

## The rubric — what PASS means per scenario

| scenario | mechanism | PASS means | fallback that means FAIL |
|---|---|---|---|
| smoke | happy path | report done ≤3min, 1 pane, 0 left, wake in-band | any stall, any dialog |
| waves | solo stage then a gate stage | writer done → gate's run passes, no pane for the gate | the gate spawning a pane |
| shots | gray-zone dialog + durable grant | ask fires, allow (needed≥~0.9) in seconds, second touch silent | deny, minute-scale latency, re-ask per touch (#79) |
| secrets | hard deny outranks roots | root stripped loudly, dialog → `deny — looks like secrets`, worker told to continue | the file being read (silent allow = the #77 class) |
| escalate | repeat-ask escalation | first deny-unneeded, repeat → granted | judge allowing arbitrary first-asks silently |
| longsilent | stall must not kill silent workers | 12-min single bash, ticks every 3 min, `done longsilent`, no kill | ANY stall kill (the j-3520f7/j-443a63/j-964391 class) |
| nested | box-in-box wake (delegated stage) | rail mints stages/child-run/, levies the child, child wake settles the stage, no deadlock | parent stalling while child runs |
| deadline | deadline_ms cap | sleep-3600 unit settles as `deadline` at the set ms, panes reaped | the run outliving the ceiling (or dying early) |
| forgotten-marker | status-first settle (#178) | agent that never writes a marker settles on result.md (`idle+grade`), survived in the report | a marker being required, or a stall kill |
| transfer-window-v2 | the composite eval case — all five topologies, one chain | ≤30min: five stage rows green, grade gate's verify.sh `PASS squad=… spent=…/60000`; rehearsal green (below) | any stage row red, or verify.sh FAIL (it hard-fails arithmetic/coverage/duplicates/schema) |

Cross-cutting, every run: wake `delivery=pane` to the levy's registered pane
(check `<run>/../job.json` → `woke.delivery`); the one sanctioned `queued` is
a nested child (its parent rail polls the receipt).

## Known-sharp edges (keep an eye)

- #78 — under many CONCURRENT spawns, some workers never receive their brief
  (sessionless pane, zero output). Sequential runs pass. Retry-verify before
  trusting a concurrent battery result.
- #79 — a dir grant does not yet cover paths under it.

## Tuning

Each scenario is 2-3 tiny files: `workflow.toml` (the `[[stage]]` chain,
`deadline_ms`, settle modes), `hooks/grade.sh` + `hooks/counts.sh` where a
scenario wants its own verdict rows, and `roots.txt` where a scenario
deliberately roots a target (secrets).

## transfer-window-v2 — the composite eval case (OPTIMUM's exam)

All five topologies in one chain (ingest solo → analyze fan-out with
per-unit pins → negotiate coworker → scout lab with an inline end
detector → grade gate). Deterministic offline player universe, hard
budget arithmetic, verify.sh that CHECKS.

Bring-up: `python3 test/e2e/transfer-window-v2/gen-universe.py` (fixed
LCG seed, no network — writes `data/players.csv` + `data/window.json`).
Real run (the ops eval lane's ≤30-min bench; `deadline_ms = 1800000` is
the case's own bound):

```bash
cd test/e2e/transfer-window-v2 && python3 gen-universe.py \
  && <repo>/bin/whl run . --from opencode:<your-session-id>
```

PASS = the five stage rows green and the grade gate's verify.sh PASS
line: spent == Σ squad fees ≤ the window's cap (arithmetic EXACT),
coverage gk≥1 def≥3 mid≥3 fwd≥2, no duplicate ids, every squad id/fee
matching players.jsonl exactly, and every squad id probe-verified by
the scout (fit threshold 1.0). Mock rehearsal (seconds, zero tokens):
`rehearse.test.ts` is part of `npm test` — it drives the REAL
orchestrator (waves, checks, mint, levies, bookings, gate) with
scripted minds, and its negative run proves the vibe-proof: a
schema-valid plan with ONE doctored fee sails through every mid-chain
check and dies at the grade gate with `FAIL universe:`.

Delivery across the delegated stages (the pattern STAGES.md names):
analysts write shards into `stages/negotiate/data/` (staged into the
child at the levy); the negotiate and scout stages' `check` hooks
(`hooks/accept-*.sh`) resolve the child's job dir through the wake
booking (`wakes/<id>.json`) and land the child's artifacts in the
parent `data/` — the grade gate judges everything parent-side.

KNOWN SEAM (receipted 2026-10-20, j-5c1861 — NOT patched here; the
scope fence is the experiment): a coworker stage's minted child
(`stages/<id>/workflow.toml`, minted by src/engines/orchestrator.ts)
carries no `kind = "coworker"` line, so the run door refuses it as a
stage-less fan-out ("no [[stage]] entries"). The declaration is sound —
loadManifest parses it (corpus pin), the mint mints it, the chain
compiles it; the fix is rail-side (the mint writes the kind marker, as
it already does for labs — pinned for labs in test/stages.test.ts, and
unpinned for coworker, which is exactly how the seam survived). The
rehearsal seats both delegated stages through the levy port the test
suite itself uses; the REAL run lands when §1 re-opens on this receipt.
