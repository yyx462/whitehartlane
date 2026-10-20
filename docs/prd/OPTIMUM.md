# OPTIMUM — the product direction, refit from the full trajectory

> REGENERATED, never appended (house law for plan pages applies here).
> This file is the MOMENTUM VECTOR: a fit over every merged PR, not a
> description of the latest state. The latest state is one sample; the
> trajectory's direction is the estimate of the optimum.
>
> Refit protocol (mechanical, ~30 min): `gh pr list --state merged`
> → one line per PR: what direction it pushed, which component →
> group by component → mark reversals (A→B→A = the axis is wrong) →
> rewrite this file whole. Never edit a single block in isolation.
>
> Refit 1: 2026-10-19, over PRs #2–#159 (110 merged).
> Refit 2: 2026-10-19, over PRs #2–#167 (117 merged; +7 since refit 1,
> the loop-v2 era: #161–#167). Zero strikes, no ESCALATED records; one
> infra event (#165/#166 — unborn-worker spawn class; the loop dog-
> fooded exactly as D7 predicted).
> Refit 3: 2026-10-19, over PRs #2–#170 (120 merged; +3 since refit 2:
> #168 this file's refit-2 landing, #169 a loop-side amendment — D1's
> sign gate removed, constitution docs, no component code — and #170,
> §2's stated final slice). Iteration 2 landed GREEN: receipt 1 round /
> 0 strikes / no gate-error, eval green on the joint target. Zero
> strikes, no ESCALATED records; D3 remains unexercised (a circuit
> breaker, not a KPI).
> Refit 4: 2026-10-20, over PRs #2–#172 (122 merged; +2 since refit 3:
> #171 this file's refit-3 landing, #172 permissions slice 2 — the
> third loop-v2 iteration to land on its named target, GREEN the hard
> way: the 18:18 landing eval died red inside zhipuai's 5-hour quota
> window with no RESULT.md, the fixer's bounce record root-caused it as
> INFRA with the branch untouched, topo-tune re-proven directly,
> regate PASS 00:24, merged). No same-cause strike ever billed
> (strikes.json {}); no ESCALATED records; D3 unexercised.
> Refit 5: 2026-10-20, over PRs #2–#174 (123 merged; +2 since refit 4:
> #173 this file's refit-4 landing, #174 the relay events fold — §8
> EXECUTED, the fourth loop iteration to land on its named target
> (#167, #170, #172, #174), receipt 1 round / 0 strikes). Two infra
> events, neither a strike (correctly, D4): #173's absorb refused
> once ("evidence incomplete" — the refit lane's ≥2-PR-refs fence;
> human-merged 01:48, loop continued), and iteration 4 died driver-
> side (revive4's adopted fixer failed → DEAD-iter4; re-armed as
> iteration 5 on the same target, landed clean). strikes.json {};
> no ESCALATED records; D3 unexercised.
> Refit 6: 2026-10-20, over PRs #2–#176 (125 merged; +2 since refit 5:
> #175 this file's refit-5 landing (absorbed clean), #176 program-
> grammar slice 1 — iteration 6 GREEN, receipt 1 round / 0 strikes /
> topo-tune green on the joint target (33,8), cap 900 = the diff
> exactly (250+/650−)). Zero strikes, no ESCALATED records; D3
> unexercised. The commissioning's MAX-6 budget is consumed (iters
> 1,2,3,4-dead,5,6): slice 2 arms under a FRESH commissioning on this
> refit's proposal.
> Refit 7: 2026-10-20, over PRs #2–#181 (127 merged; +6 since refit 6:
> #177 this file's refit-6 landing, the daytime clean sweep #178/#179/
> #180 — ADR 0015's platform pen, the workerStatus verb, package-by-
> feature + the AgentHost/Transport ports — and #181, commissioning
> 2's iteration 1: the flight bench, GREEN 1 round / 0 strikes,
> 749 ≤ cap 900). Commissioning 2 opened 18:02 on momentum.py's
> mechanical seed (runner-dispatch), not refit 6's slice-2 proposal —
> BUDGET-OUT had closed commissioning 1 minutes after refit 6 wrote
> it; this refit re-arms slice 2 with the blast set re-pathed onto
> #180's package layout. No strikes file exists (none ever billed);
> no ESCALATED records; D3 unexercised (a circuit breaker, not a KPI).
> Refit 8: 2026-10-20, over PRs #2–#183 (129 merged; +2 since refit 7:
> #182 this file's refit-7 landing, absorbed clean in 38s; #183
> program-grammar slice 2's ENGINE half — spur.ts deleted whole, the
> run door refuses spur.mjs/dag.mjs, lab's spur branch and the [gates]
> detector gone — GREEN 1 round / 0 strikes, 991 ≤ cap 1000 (93+/898−),
> topo-tune green (33,8); armed by refit 7's NEXT-TARGET chained
> as-written, the amended D1 working end to end). The MUSEUM (test/e2e/
> + examples/*-spurs, ~2.3k lines) is #183's own stated next slice and
> ADR 0014's flip condition — armed here as slice 3. Zero strikes, no
> ESCALATED records; D3 unexercised.
> Refit 9: 2026-10-20, over PRs #2–#185 (130 merged; +2 since refit 8:
> #184 this file's refit-8 landing, absorbed clean in 44s; #185
> program-grammar slice 3 — the museum conversion, c2-iter3, armed by
> refit 8's NEXT-TARGET chained as-written). #185 landed GREEN the
> revive way: the driver died at commissioning (19:35, no obituary)
> while the fixer survived; revive3 hand-landed the PR — gate PASS
> 20:37, topo-tune green (33,8), merged + pulled — 369+/1436− across
> 103 files, all in blast, 1805 ≤ cap 2500, 1 round / 0 strikes, npm
> test 442/442 (440 + 2 new corpus tests). ADR 0014 flips fully to
> EXECUTED: §1 is CLOSED. Zero strikes, no ESCALATED records; D3
> unexercised. The pick flips the streak: rank-1 runner-dispatch,
> read and overridden BY RECEIPT six refits running, is PICKED for
> the first time — narrowed by receipt to its one named residual.
> Refit 10: 2026-10-20, over PRs #2–#188 (137 merged in momentum.py's
> 120-day window; +2 since refit 9: #187 this file's refit-9 landing,
> and #188 the member court — §2's named residual fold, commissioning
> 2's iteration 4, armed by refit 9's NEXT-TARGET chained as-written,
> GREEN 1 round / 0 strikes, 305+/119− (424 ≤ cap 800), all 4 files in
> blast, npm test 444/444, topo-tune green (33,8)). The residual is
> EXECUTED: §2 again holds no known-simpler alternative, and no
> component on the table holds an open named residual — so the pick
> moves, by the sequencing receipt five refits wrote, to the
> milestone's last unbuilt leg: the composite eval case, ARMED as
> c2-iter5. Zero strikes, no ESCALATED records; D3 unexercised.
> Refit 11: 2026-10-20, over PRs #2–#190 (131 merged; +2 since refit
> 10: #189 this file's refit-10 landing, and #190 c2-iter5 — the
> composite eval case transfer-window-v2, AUTHORED whole: +682/−0
> across 17 files, all in blast (test/+docs only, zero src BY DESIGN),
> 682 ≤ cap 900, GREEN 1 round / 0 strikes, topo-tune green (33,8),
> npm test 447/447, merged + pulled 23:17). The scope fence was the
> experiment and it YIELDED: the case parsed, minted, compiled, and
> pinned with zero src changes — and the real run surfaced the one
> seam the fence was built to catch (receipt j-5c1861: the coworker
> child mint omits `kind`, so the door refuses the minted child as a
> stage-less fan-out). #190 receipted the seam in its PR body instead
> of silently patching src outside its blast — D3's evidence branch,
> exercised by the fixer's own discipline rather than by a strike.
> Zero strikes, no ESCALATED records; the strike path stays
> unexercised (a circuit breaker, not a KPI). The seam is ARMED as
> c2-iter6 — commissioning 2's last budget slot (5/6 consumed).

## L0 — the product thesis (one page)

The rail is **mechanism hosting declarations**. Consequences:

1. **Programs are data.** A workflow is a TOML declaration (`[[stage]]`
   chain); the rail executes what is declared and refuses what isn't
   parseable — refusal beats silence, always. No workflow runs on a
   mind (#31): there is no orchestrator agent; there is a tick.
2. **Minds are delegated and fresh.** Workers, members, actors — every
   mind is a fresh session briefed from exactly one source (stage brief,
   roster brief + preamble); continuity is the container/filesystem,
   never a context window. Order is the trigger rule (initiates, waves),
   never brief text.
3. **Ordering is the chain.** Stages in table order; a stage declares
   its own topology (solo | fan-out | coworker | gate | lab) and its own
   hooks. "Split" is dead — a chain was always the workflow's job.
4. **Verdicts are honest.** Four verbs, never confused: check = judge,
   run = act, grade = bind, signal/end = observe. Infra faults never
   wear answer-failure labels (#145). The task verifier fires only
   where a stage binds it (#150).
5. **One wake per commission.** The levy commissions and walks away;
   delivery climbs a traced ladder (ADR 0008). A paused run is booked,
   not lost (ADR 5).
6. **The window is the viewer.** Never a participant (#69).
7. **A mind's pin is its nearest declaration** (unit → stage →
   workflow), and pins are declarations, not strategies (#159).

The thesis held under refit 11, and #190 is its capstone: the
composite case — five topologies, one chain — authored against
`[[stage]]` alone, 682 lines of pure declaration (fixtures, hooks,
rehearsal, rubric), zero src files. The grammar needed no new syntax
to express the exam this file spec'd since refit 4; and what the exam
surfaced was not a grammar gap at all but one engine emission seam —
the coworker child mint dropping `kind` (§2's block, this refit's
pick), exactly the separation the thesis claims: the declaration was
sound, the dispatch was not. The direction since #176 is one line; no
new axis appeared; oscillation is 0 across the whole table.

Empty quadrants (never explored — the fit cannot see them, so they are
listed instead): remote/multi-machine workers; a visual program
composer; hot-reload of a running chain; multi-tenant doors; task-level
detectors/veto/requeue riding a DELEGATED child (the inbox-zero
semantics — #185's new finding, recorded in ADR 0014: a minted child
carries no hooks folder; today the declaration cannot express it). Any
of these may be the true optimum's home; treat as research, not refit.

## L1 — components

Momentum table (`momentum.py`, 2026-10-20, 120-day window — whole-PR
churn attribution, coarse v1; the attribution globs predate #180's
package-by-feature move — see the gaps note below):

| component | fix-density | oscillation | churn | runtime-loss | score |
|---|---|---|---|---|---|
| runner-dispatch | 80 | 0 | 44880 | — | 124.9 |
| window | 27 | 0 | 16364 | — | 43.4 |
| permissions | 13 | 0 | 10717 | — | 23.7 |
| resume-parking | 5 | 0 | 2473 | — | 7.5 |
| wake-ladder | 1 | 0 | 1153 | — | 2.2 |
| model-pinning | 1 | 0 | 777 | — | 1.8 |
| relay | 0 | 0 | 0 | — | 0.0 |
| program-grammar | 0 | 0 | 0 | — | 0.0 |

Reading the table (refit 11): rank 1 **runner-dispatch** (124.9) —
for the NINTH consecutive refit the arithmetic tops the table, and
this refit is the SECOND time it is picked BY RECEIPT (refit 9: #188's
named residual; refit 11: #190's seam): #189 (docs-only, 1 file) and
#190 (test/e2e-only, 17 files, zero src) changed no component's code,
so the table is byte-identical to refit 10's — the churn stock froze,
correctly — but the case's real run put a LIVE defect receipt on the
component's own file: the coworker child mint
(`src/engines/orchestrator.ts:1068`) omits `kind`, the door refuses
the minted child (j-5c1861). The stock read stands (the churn is
converged work, not sickness); the pick rides the fresh receipt, not
the stock. Rank 2 **window** (43.4) unchanged since refit 3's churn
read — nothing under `web/` since. Rank 3 **permissions** (23.7)
converged (#172). Rank 4 **resume-parking** (7.5) frozen. Rank 5
**wake-ladder** KEEP. Rank 6 **model-pinning** WATCH (its watch
surface is now AUTHORED — #190's analyze stage declares per-unit
pins; evidence can only arrive at the real run). Rank 7 **relay**
(0.0) converged (#174). Rank 8 **program-grammar** — 0.0 forever
(its globs own no code file) — CLOSED at refit 9 (#176, #183, #185;
ADR 0014 EXECUTED), and its graduation exercise is now AUTHORED
(#190, zero src: the grammar's proof held) with the one finding the
exam surfaced filed where its fix lives — §2.

Attribution gaps (human note — the constitution is not refit's to
edit): #180's package-by-feature move made the flat globs structurally
stale — only `src/engine*` still matches anything (fnmatch's `*`
crosses `/`, catching all of `src/engines/`), while `src/core/*`
(state, permission, workflow-kind, orchestrator-chain), `src/doors/*`
(hooks, run, spur — the authoring dialects), `src/adapters/*` (store,
rail, levy, wake) and `src/ports/*` bill 0.0 to everyone from #181
on. Proof by receipt: #178's state.ts work bills to resume-parking
ONLY because #178 predates the move (flat paths in its file list);
#181 — the first post-move PR — could bill only through
src/engines/orchestrator.ts; #183 — the second — bills its whole 991
through src/engines/lab.ts while its doors/* deletions (spur.ts
wholesale!) bill nothing; #185 — the third — bills exactly zero
(no src file in a 103-file PR); #188 — the fourth — bills its whole
424 through src/engines/* and is the first post-move PR whose billing
is TRUE under both glob sets; #189 (docs-only, 1 file) and #190
(test/e2e-only, 17 files, zero src) bill 0.0 to everyone — correctly:
no code file exists in either diff to bill. At the next constitution
touch: re-path
the globs onto the package layout — program-grammar should own
`src/doors/{hooks,run,spur}.ts`, relay `src/adapters/store.ts`,
resume-parking `src/core/state.ts`, permissions
`src/core/permission.ts`, wake-ladder `src/adapters/wake*`,
runner-dispatch `src/engines/*`.

### 1. Program grammar
- **Concept**: shape + hooks declared per stage; compiles to the
  fan-out core (units, waves, grade plan, pin plan).
- **Trajectory**: #5 one DAG file, tick-only scheduler → ADR 0007
  #42/#43/#50 settle-typed steps → ADR 0009 dag→spur rename →
  units-hook quick-mint (arm-e era) coexisting → #153–#158 stages
  (5 topologies, per-stage hooks, preamble, pins, manual) → refit 5
  lifts the levy-migration gate on evidence → **#176 slice 1 — one
  authoring story, half-landed (ADR 0014)**: `[[step]]` tables REFUSED
  at parse pointing at `[[stage]]` (issue #152's mutual refusal is now
  one-way); `hooks.units` quick-mint refused (workers are declared,
  never minted at runtime); a stage-less fan-out manifest refused at
  the door BEFORE booking; the driveLife tick-harness and its toy
  tests deleted; the shared example is a `[[stage]]` fixture
  (three-lookups). Steps survive only as the compilation target of
  stages — internal, never authored. → refit 6 armed slice 2
  (NEXT-TARGET program-grammar, cap 1000) — BUDGET-OUT closed
  commissioning 1 minutes later; commissioning 2 opened on the
  driver's mechanical seed instead (runner-dispatch → #181), which
  landed while DELIBERATELY preserving the lab end-fold (#181's
  stated next slice: "the lab's end-fold belongs to §1 slice 2") →
  **#183 slice 2's ENGINE half, EXECUTED** (c2-iter2, armed by
  refit 7's NEXT-TARGET chained as-written — the amended D1 working
  end to end): `src/doors/spur.ts` deleted WHOLE (238 lines — the
  ADR-0009 step scheduler; every consumer gone); the run door
  refuses `spur.mjs`/`dag.mjs` (named directly or folder-held)
  naming the fix (a `[[stage]]` chain; the experiment is
  `topology = "lab"`); lab.ts's spur branch deleted (tick loop, gate
  steps, reopen machinery, the write-only `finished` accumulator —
  the lab engine runs only its workflow.toml shape, the shape a lab
  stage mints as its child, wake-steps.test.ts's demonstrated
  path); the `[gates]` detector table refused at load pointing at
  `topology = "gate"` + `run` (stages bind verify.sh — #150) →
  **#185 slice 3 — the museum conversion, EXECUTED** (c2-iter3,
  armed by refit 8's NEXT-TARGET chained as-written; hand-landed by
  revive3 after the driver died at commissioning — the fixer
  survived, the gate did not flinch): test/e2e's ten retired-spelling
  programs are `[[stage]]` chains (worker briefs inline; the units.sh
  JSON wrappers and their "follow the log protocol" boilerplate
  deleted — the rail's briefFor owns that contract; the [[step]]
  writer/check/warmup/wake shapes became solo + gate + coworker
  stages; nested/child/ deleted — the rail mints the child now;
  run-battery.sh's scenario dirs kept their names, the README
  rubric rewritten to the stage spelling); the chain-shaped examples
  converted (staged-waves solo→gate→fan-out; two-signoffs' end/check/
  check → two gate stages; nested-wakes a coworker stage; hand-off's
  three-rail wake chain ONE rail — draft solo + review coworker{check,
  publish}; git-wave a lab stage with an INLINE end detector — a
  delegated child carries no hooks folder; trivia-bench a lab stage
  with the actor grading its own rounds); museum pieces with no
  honest stage spelling DELETED, not faked (lab-program — its shape
  IS the lab stage; inbox-zero; three-lookups — its living form is
  test/fixtures/three-lookups, #176, test/util.ts's EXAMPLE; the four
  screenshot-era coworker shells that never had member briefs);
  pure exchanges stay members-shaped BY THE DOOR'S OWN RECEIPT
  (src/doors/run.ts's fan-out-only refusal, #176: "coworker carries
  members, a lab its actor; neither needs stages" — one dialect per
  SHAPE, not one shape for everything); **test/corpus.test.ts pins
  the corpus** — every workflow.toml under examples/ + test/e2e/
  parses through loadManifest (the door's own refusals fire on
  parse), fan-out-shaped ⇒ declares stages, and a spur.mjs/dag.mjs
  sweep: a future museum donation cannot land. 369+/1436− across 103
  files, all in blast, 1805 ≤ cap 2500, 1 round / 0 strikes, npm test
  442/442, topo-tune green (33,8). ADR 0014 flips fully to EXECUTED.
  → **#190 — the case AUTHORED, the rail-side leg EXECUTED** (c2-iter5,
  armed by refit 10's NEXT-TARGET chained as-written; landed GREEN
  1 round / 0 strikes, 682+/0− across 17 files, all in blast, 682 ≤
  cap 900, topo-tune green (33,8), npm test 447/447): gen-universe.py
  — a deterministic offline player universe (fixed LCG seed, no
  network): 96 messy CSV players + data/window.json (cap £60m,
  coverage 1/3/3/2, fit 1.0); workflow.toml — the five-stage chain
  exactly as this file's spec block (ingest solo check=jq; analyze
  fan-out 3 analysts, preamble + per-unit glm-5.3-flash pins — §6's
  watch surface, now authored; negotiate coworker DOF(initiates)+
  capologist; scout lab, INLINE end detector; grade gate verify.sh);
  hooks/ — check-ingest, check-shards (jq per shard), accept-plan/
  accept-scout (the OUT-of-child delivery fold: wake booking → parent
  data/), verify.sh (budget arithmetic EXACT, coverage, no duplicate
  players, output schema, squad fees vs universe, probe fit — hard
  fails); rehearse.test.ts — the mock rehearsal, seconds and zero
  tokens: the REAL orchestrator walks the REAL toml (waves, checks,
  mint, levies, bookings, gate) with scripted minds at the test
  suite's own fake seams, and the negative run proves verify.sh
  CHECKS — one doctored fee, schema-clean, arithmetic-exact, dies at
  the gate with FAIL universe; corpus.test.ts auto-pins the new tree;
  README rubric row + section; run-battery.sh opt-in (TW2=1); STAGES.md
  documents the delegated-delivery fold. **The scope fence was the
  experiment, and it yielded its receipt**: the declaration expressed
  the case whole — zero scope strikes, zero src files — so D3's
  impossibility branch never fired and §1 does NOT re-open; what the
  REAL run surfaced (receipt j-5c1861, 2026-10-20: the coworker child
  mint omits `kind`, the door refuses the minted child as a stage-less
  fan-out) is an ENGINE emission seam, not a grammar gap. #190's body
  said "§1 re-opens on this receipt"; this refit reads the receipt's
  substance — the fix touches zero grammar-owned surface and one
  engine file (`src/engines/orchestrator.ts:1068`) — and files it
  under §2 as the armed pick. The grammar itself needs nothing: the
  strongest KEEP there is.
- **Oscillation**: RESOLVED — the whole three-slice run was monotone
  deletion: #176 (250+/650−), #183 (93+/898−), #185 (369+/1436−);
  zero reversal pairs across all three; #190 pure addition (682+/0−,
  zero src). Zero attribution ever — the globs own no code file
  (#183's doors/* deletions, #185's whole 103 files, #190's 17-file
  test/docs tree all bill 0.0 — the gaps note's receipts).
- **Simpler alternative**: EXECUTED — the milestone's last GATED
  alternative closed by #185; the graduation case authored whole
  against what remains (#190) with zero src changes — the "one
  authoring story" claim now carries its exam receipt. One NEW
  finding on the books from the real run (the mint-kind seam — §2's
  armed pick) plus the earlier delegation-boundary finding (recorded
  in ADR 0014, #185's PR body: task-level detector/hook files cannot
  ride a minted child). Both are engine/emission questions, not
  grammar regressions; the empty-quadrant listing holds them.
- **Verdict**: KEEP (converged at refit 9 — receipts #176, #183,
  #185; ADR 0014 EXECUTED — and its graduation exercise AUTHORED
  whole at refit 11 by #190, zero src: the grammar needed nothing).

### 2. Runner dispatch
- **Concept**: ONE kind-blind door; the engine is picked once,
  in-process (`engineFor`); ONE chain object owns waves/frontier/
  finish; one walker dispatches kind-specific step executors.
- **Trajectory**: #3 name the orchestrator → #4 split lab from
  fan-out → #26 one shared host → #31 no mind runs a workflow →
  #153–#156 delegation rejoins authoring → **loop-v2 slices**:
  #161 one runner door (kind→bin mapping, two bins, the wrong-bin
  refusal — deleted) → #164 run envelope rail-owned (one spawn verb
  `spawnRunner`, one label-scoped `bookedWait`, one signal protocol;
  the door stops branching on kind; #162's known bin-read cost paid)
  → #167 the chain object (`chainOf` owns frontier/gateOf/
  unreachable; `advance()` walker + execCheck/execGate/execWake;
  `stepRecorder` = the one finish ceremony — orchestrator.ts shrank
  while gaining the dispatch table) → #170 lab pause parity (the
  experiment outlives the process: `labBookings` folds the pane
  ledger into resume pointers, one `flights` map replaces
  born+mockPane, SIGTERM drains to quiescence and PARKS, a continued
  lab resumes the actor's AND every mock's booked session — nudge,
  never re-brief; the never-matching fan-out resume wiring deleted
  with a live probe receipt) → #172 the door's last private path
  spelling deleted (`programRootsOf` = `declareScope(readRootsTxt(
  dir)).roots` — a pure fold onto §5's predicate; the table bills
  this +1 to runner-dispatch; it is convergence churn) → #174 the
  five readers held the seam (orchestrator.ts shifted 5 lines while
  the card store under it changed — the reader NOT moving was the
  fold's receipt) → #176 the seam absorbs the one-dialect law
  (orchestrator.ts: steps resolve ONLY from `manifest.stages`; 8
  lines) → the daytime clean sweep: **#178 the platform pen (ADR
  0015)** — `settle_mode = "status-first"` arms the pen: a pane whose
  harness status is idle settles on the deliverable itself
  (`probeDeliverable` judges SHAPE — result.md present, non-empty;
  semantics stay at the stage gate; the card carries `trigger:
  "idle+grade"` so a fold can prove the settle status-driven, never
  timer-driven); a missing deliverable at idle is an EVIDENCE
  reprompt quoting the check and naming the artifact (never a plea —
  Claude Code #55754's bill), hard-capped at 8; `WakeBooking` gains
  `parentUnit` + `spawnerSession` (meaning in the names); an idle
  parent with a live booked child waits by design; `fallback_ladder
  = false` suppresses the stall verdict inside the trial window →
  **#179 workerStatus** — liveness is ONE verb (the rail asks the
  harness, never scrapes a pane) → **#180 the move** —
  package-by-feature (`src/engines/` + the AgentHost/Transport
  ports: the host behind the bench is a seam now) → **#181 the
  flight bench**: ONE Beat observation per flight per beat (marker,
  paneStatus, privilege, lazy waited/booked, size/grew, ages — the
  bench never touches shep/fs directly); an ORDERED bench of judges
  (marker, liveness, privilege, grace, pen, stall) — the FIRST
  ruling wins, `benchOrder()` pure and test-pinned; ONE bailiff
  (`applyRuling`: close / carry / defer / reprompt — the close
  ceremony that was hand-rolled at ELEVEN sites is one spelling);
  the mode flags SEAT judges instead of guarding rungs (the pen sits
  only in a status-first court; every drain unseats stall, never the
  pen). Deleted: the ~240-line interleaved cascade, `faultUnits` (a
  write-only set dead since the #145/#162 era), the cross-rung mode
  guards; one honest bug fixed under the bench (the capped close
  card read `undefined:<id>` — now `unit:<id>`, pinned) → #183:
  NOT this component's work — §1's engine retirement mis-billed
  here through src/engines/lab.ts (its only attribution-eligible
  file; +991 churn, +1 fix-density, both §1's substance) → #185:
  not this component's work either (zero src files; bills nothing)
  → **#188 the member court — the residual fold, EXECUTED** (c2-iter4,
  armed by refit 9's NEXT-TARGET chained as-written; landed GREEN
  1 round / 0 strikes, 305+/119− = 424 ≤ cap 800, 4 files all in
  blast, npm test 444/444): coworker-run.ts's hand-rolled member
  stall court — the bench's second customer, #181's own stated next
  slice — folds onto the flight bench. ONE typed **MemberBeat** per
  member per beat (privilege/liveness/stall evidence; `booked` +
  `pendingNote` lazy getters — #181's law: only the judges that pay
  read the disk). ONE bench algorithm: `firstRuling` exported from
  orchestrator.ts, the Judge generic over the beat — the ordered
  court privilege → liveness → stall is walked by the same function
  `cycle()` seats for fan-out flights; two engines, one algorithm.
  ONE bailiff: **`closeMember` is the only dead-record spelling**
  (dead + deadWhy + ledger wake + log + watcher say) — the deny cap,
  spent transport retries, the nudge cap, AND the model ladder's
  three death sites all close through it; the model-ladder deaths
  never woke the levy before (log-only) — now every death does.
  DELETED from coworker-run.ts: the `nudged` map, the deferred set,
  the stoodDown set (ONE MemberFlight record, reset by respawn —
  a respawned member faces a fresh ladder, test-pinned), the
  interleaved stall guard, the pane-death loop, the deny-cap block,
  five bespoke dead-record closes. Precedence receipt: liveness now
  OUTRANKS stall — issue #122's law (pane death is transport, never
  an answer) taken to the bench; the old order could nudge a dead
  pane in a one-beat race; pinned: "a pane that dies mid-ladder is
  a transport close — the ladder never fires again". Booked wait
  stands down as a judge (ADR 0006; #164's one spelling
  `rail.bookedWait`), not a private set. The drain still parks
  before the court sits; docs/RAILS.md documents both courts. The
  bench's customer count after #188: TWO seated (fan-out `cycle()`,
  coworker member court) — no third on the books: the lab's close
  ceremony is marker-driven (endOf's dead-rule + log markers, #170's
  one resume nudge), not a booked-flight stall court; if evidence
  ever names it a fold, that is a NEW receipt reopening this block,
  not an armed one. One arrived at refit 11, from the exam, not from
  the lab → **#190's receipt — the mint-kind seam, ARMED as c2-iter6**
  (this refit's pick): the composite case's REAL run died at the door
  (j-5c1861, 2026-10-20: "no [[stage]] entries in
  …/stages/child-run/workflow.toml") — the coworker child mint
  (`src/engines/orchestrator.ts:1068`) writes `kind = "lab"` for labs
  and NOTHING for coworker stages, so the door (`src/doors/run.ts:261`
  defaults the kind to fan-out; `:296–302` refuses stage-less
  fan-outs — correctly, per #176's own refusal) classifies the minted
  child as a stage-less fan-out and refuses it. The lab mint carries
  the marker and is pinned (`test/stages.test.ts:614`,
  `^kind = "lab"$`); the coworker mint was NEVER pinned — exactly how
  the seam survived #176's door. The door needs nothing
  (`src/core/workflow-kind.ts:5` already accepts `"coworker"`); the
  fix is the mint's one line plus the pin the lab mint already has.
  #190 receipted this in its PR body rather than silently patching
  src outside its test/+docs blast — the scope fence teaching, and
  the fixer obeying, exactly as D3 intended evidence to arrive.
- **Oscillation**: RESOLVED. Zero reversal pairs — the line runs
  NINE authored slices (#161→#164→#167→#170→#172→#176→#181→#188,
  plus the mint-kind fold armed as c2-iter6) plus two echo billings
  (#183/#185, §1's substance). Refit 6's falsified "none left"
  lesson stays carried: the claim below is about the CURRENT seam's
  shape, not about the component — and #190 just proved the lesson
  again: a block declared residual-free at refit 10 grew one by
  receipt at refit 11 without ever being wrong in between.
- **Simpler alternative**: ONE named residual, ARMED — the mint-kind
  fold (#190's receipt, c2-iter6): emit `kind = "coworker"` at the
  mint, pin it where the lab pin lives. Everything else on the books
  is EXECUTED (#188 closed the last); the bench is the simpler
  alternative and both its customers are seated.
- **Verdict**: KEEP (converged at refit 10 — receipts #161–#176's
  line, the bench #181, the fold #188 — with the mint seam armed as
  c2-iter6, picked BY RECEIPT for the second time in the component's
  history).

### 3. Wake ladder
- **Concept**: one wake per commission; spool-first, per-rung trace.
- **Trajectory**: #25 in-band wake, nesting → #60 ADR 0008 spool →
  #95 ladder + fail button → #96/#97 fork-seed roots → #138 v2 plugin
  port → #164 spawn failures arm 30s retries via the ladder (unborn
  workers leave the stall ladder's jurisdiction, #166) → #178/ADR
  0015: `WakeBooking.parentUnit` + `spawnerSession` make the wait-for
  DAG receipt-backed; `waitingOnLiveChild` folds dangling edges to
  "not a wait"; #188 deepens the ledger reach: EVERY member death now
  wakes the levy through closeMember's ledger emit (the model
  ladder's three death sites were log-only before). Declared
  follow-up — the event-driven wake (`herdr agent wait --until idle`)
  so the settle fires on the transition instead of the next beat.
- **Oscillation**: LOW (one softening: in-band → spool-first).
- **Simpler alternative**: none known (the event-wake follow-up is a
  declared platform upgrade, not a reversal).
- **Verdict**: KEEP.

### 4. Resume / parking
- **Concept**: drain to a boundary; park booked; resume from booked
  sessions; regrade is the minimal rerun (ADR 5).
- **Trajectory**: #16 pause/abort/continue → #18 session booking →
  #71/#72/#75 stall hearts, worktree ladder → #114–#116 bench-grade
  fleet → #145 grade contract + regrade → #162 ONE unit ledger
  (state.json deleted; every settle = one unit-carrying card;
  `readState` a pure fold, last card wins — regrade flips by
  appending) → #164 the door reads the ledger (`unitsOf` folded) →
  #170 the law reaches the lab (booked sessions resumed via the
  pane-ledger fold — the same ledger, the third reader; the
  w-<id>→bare re-key fixed at the engine seam that owns the
  convention, with a production-silently-broken receipt) → #174 the
  residual fold EXECUTED under §8's mandate (task-dir
  `checkpoints.jsonl` retired onto the OS-disk events trace; §4's
  card interface — checkpoint/settle/readState/readCheckpoints —
  unchanged; ADR 0013) → #178/ADR 0015: the settle card carries
  `trigger: "idle+grade"` (a fold can prove the settle
  status-driven, never timer-driven) and `unit.grade` becomes a
  trace event — the evidence before the ruling.
- **Oscillation**: LOW; deepening honesty throughout.
- **Simpler alternative**: EXECUTED at every level. The three-stores
  sickness (checkpoints cards + state.json + booked sessions) is
  cured whole: #162 one ledger, #174 one carded store — the events
  trace itself. Booked sessions remain as a different aggregate (the
  JOB's lifecycle — L0 "paused is booked, not lost"), correctly not
  consolidated.
- **Verdict**: KEEP (converged; receipts #162, #170, #174).

### 5. Permissions
- **Concept**: privilege is rail-owned; ONE canonical path predicate
  constructed from the declaration; deny outranks roots; a dialog is
  progress.
- **Trajectory**: #6 → #14 → #29 → #33 → #38/#58 scratch → #71 sweep →
  #77 deny>roots → #83 path repair → #99 brownout → #163 slice 1:
  the PathScope (declareScope/decidePermission/scopeCovers; admission
  now refuses briefs under hard-deny roots; the drift evidence —
  three temp/regex spellings, two glob spellings, per-dialog
  assemblies — deleted; design record docs/prd/path-predicate.md) →
  #161's bin deletion moved the leftover duplication (the design
  record's "bins' 16-line readers" folded into `programRootsOf`) →
  refit 3 re-read the surface: exactly TWO roots.txt spellings remain
  → **#172 slice 2 — the fold**: the last private spelling gone.
  `programRootsOf` is now a pure fold (`declareScope(readRootsTxt(
  dir)).roots`) holding zero path knowledge; the loud hard-deny strip
  moved INTO the canonical predicate (`sanitizeRoots` internal,
  pinned through `declareScope`, warning at every construction site —
  the door's included); tests re-pinned at the new seam. Refits 4–10:
  not one new touch (fix-density 13 frozen since #172).
- **Oscillation**: LOW-MED historically — the fix-density was the
  symptom; both slices landed without reversal (the 12→13 delta is
  the closing slice itself).
- **Simpler alternative**: EXECUTED. The design record's closing
  condition holds on master: `permission.ts` (now
  `src/core/permission.ts` after #180's move) is the component's
  only path knowledge.
- **Verdict**: KEEP (converged at refit 4 — the second consecutive
  loop pick closed; slice 1 #163, slice 2 #172).

### 6. Model pinning
- **Concept**: nearest-declaration pins; budget ladder for refusals.
- **Trajectory**: CLI --model flag → #101 sandbox-config (opencode
  dropped the flag; panes died) → #136 router → #159 seam pins →
  3793ad1 (direct-to-master, no PR): `bin/pick-workflow` jev pin
  1.13→1.14 — config churn only, no rail src, no attribution → #188
  receipt (c2-iter4's watch item, discharged): the fold's file
  imports the jev model-ladder seam (budgetAction/nextModel) and the
  fold touched none of it; no pane-path pin evidence surfaced — the
  block stays WATCH on the same warrant as before.
- **Oscillation**: HIGH historically (3 transport changes in ~2 weeks);
  #159 settles authoring; pane-path vs CLI-path asymmetry remains.
- **Simpler alternative**: ONE pin transport — directional only; it
  becomes a milestone violation the moment new evidence arrives, and
  none has (#159 is the last rail touch; the loop never followed;
  #188's fold closed its watch item clean). The watch surface is now
  AUTHORED: #190's analyze stage declares per-unit pins
  (glm-5.3-flash per analyst) — but the rehearsal seats scripted
  minds, so no pane-path evidence has arrived yet; the real ≤30-min
  run is the next place it could. If it does, this block re-opens on
  receipt, not on taste.
- **Verdict**: WATCH.

### 7. Window
- **Concept**: viewer-only; static reloads, server bounces.
- **Trajectory**: #9→#12→#15→#19/#20 (v3→v5.1) → #59/#61 diagram →
  #69 no lane pane → #139 perf → #146 doorNowRev memoization →
  loop-era: #145 grade rendering, #162 ledger read, #151/#64 polish.
- **Oscillation**: LOW — monotonic refinement.
- **Simpler alternative**: none pending. Refit 3 performed the churn
  read refit 2 instructed: the loop-era churn is the SERVER mirroring
  rail-side redesigns (grade contract #145, unit ledger #162, scan
  perf #139) — follower churn, not window-intrinsic sickness; the
  viewer-only line has held since #69. Refits 4–10: nothing new under
  `web/` — the read stands. ADR 0014 exempts the viewer's own
  `[[step]]` manifest renderer deliberately (it renders HISTORICAL
  run dirs with its own parser — history-keeping, not authoring).
- **Verdict**: KEEP. Stays #2 on the table (43.4) by follower churn;
  not a candidate until a window-INTRINSIC question appears.

### 8. Relay
- **Concept**: members' briefs + wire protocol; refusals speak;
  deliveries outlive memory.
- **Trajectory**: #10 born booked/fork/relay → #98 refusals speak →
  #122 transport retry → delegation #153+ → #164 one booked-wait
  spelling (the dead member-nudge filter deleted with it) → **#174
  the events fold, EXECUTED**: ONE carded store — every ledger card
  is a `unit.card` event on the run's session trace (store.ts's
  `events.jsonl`); the task-dir `checkpoints.jsonl` is retired; the
  task dir keeps only the delivery interface. The seam held:
  state.ts's card functions unchanged, the five readers untouched
  (ADR 0013 is the design record; 261+/54−, one fixer round, zero
  strikes, eval green (33,8)) → #181 folded two post-#174
  checkpoints.jsonl staleness lines in RAILS.md onto the trace
  (docs hygiene at a seam the bench PR was already touching).
- **Oscillation**: LOW.
- **Simpler alternative**: EXECUTED. The duplicate carded store is
  gone; the trace was already there (#162 named it, refit 4 picked
  it, #174 landed it).
- **Verdict**: KEEP (converged at refit 5 — the third loop pick
  closed on its named target: #167, #170, #172, #174).

## The loop (non-stop)

1. **Refit** the affected L1 block from full history.
2. **Worst part** = highest oscillation × runtime loss (session logs).
   Replace the whole design — never patch inside it.
3. **Eval**: mock-rehearse the composite chain (seconds, zero tokens)
   + ONE real ≤30-min bench task exercising the redesign.
4. **Merge** → back to 1.

Loop-v2 status (refit 11's read): TEN loop-era slices landed GREEN —
#167 (c1-iter1), #170 (c1-iter2), #172 (c1-iter3: one eval-red bounce
root-caused INFRA — zhipuai's 5-hour quota window, re-proven direct,
regate PASS), #174 (c1-iter5: 1 round, 0 strikes, clean), #176
(c1-iter6: cap 900 = diff exactly, topo-tune green (33,8)), #181
(c2-iter1: the flight bench — 1 round, 0 strikes, 749 ≤ 900, green on
the joint target), #183 (c2-iter2: program-grammar slice 2's engine
half — armed by refit 7's NEXT-TARGET chained AS-WRITTEN under the
amended D1, landed 991 ≤ 1000 (93+/898−), 1 round, 0 strikes, green
(33,8)), #185 (c2-iter3: the museum conversion — armed by refit 8's
NEXT-TARGET chained as-written, landed 1805 ≤ 2500 (369+/1436−), 1
round, 0 strikes, 442/442, green (33,8); the driver died at
commissioning and revive3 hand-landed it — the fixer survived, the
gate ran clean, D4's boundary held: never a gate-red round, never a
strike), #188 (c2-iter4: the member court — armed by refit 9's
NEXT-TARGET chained as-written, landed 424 ≤ 800 (305+/119−), 1
round, 0 strikes, 444/444, green (33,8)), #190 (c2-iter5: the
composite eval case — armed by refit 10's NEXT-TARGET chained
as-written, landed 682 ≤ 900 (682+/0−, zero src), 1 round, 0
strikes, 447/447, green (33,8); the first loop pick that was not a
component redesign but the milestone's exam — and the exam returned
a seam receipt, armed below). Iteration 4 of commissioning 1 died
driver-side (DEAD-iter4). Commissioning 1's MAX-6 budget consumed;
commissioning 2 (pin 335bbca) has FIVE clean iterations banked
(budget 5/6) — c2-iter6 is the LAST slot, and this refit arms it:
the mint-kind fold, one line plus a pin. After c2-iter6 lands (or
terminally fails), BUDGET-OUT closes commissioning 2 for the human;
graduation — the real ≤30-min run of the case — is ops-side (the
driver's eval lane), then the FULL benchmark pass. Every refit PR
absorbed except one (#173's absorb was refused once by the refit
lane's evidence fence — body must cite ≥2 PR refs, this file's own
authors must comply — and human-merged; #175, #177, #182, #184, and
#189 absorbed clean, #184 in 44s; #189 became this file's refit-10
state). No strikes file exists — no same-cause strike ever billed;
D3's strike path unexercised (a circuit breaker, not a KPI), though
its EVIDENCE branch was exercised at refit 11 the honest way: #190
receipted a seam in its PR body instead of striking on scope. #169
(operator amendment) made refit proposals effective as-written, which
raises this file's duty: the discount chain and pick receipts above
ARE the audit trail that keeps D2 honest — momentum.py's mechanical
rank-1 echo (runner-dispatch) was read and overridden BY RECEIPT, not
by taste, SEVEN refits running (3–8, 10), and PICKED twice (9: #188's
named residual, landed; 11: #190's seam receipt, armed as c2-iter6)
— the pick always rides a named defect in the component's own files,
never the churn stock.

**Milestone (falsifiable)**: no component with unresolved reversal
(✓ — oscillation 0 across the table); no component with a
known-simpler alternative (§1 CLOSED at refit 9 — #176 slice 1, #183
the engine half, #185 the museum, ADR 0014 EXECUTED — and its
graduation case AUTHORED at refit 11 (#190, zero src); §2 closed at
refit 3, re-opened by #178/#179, closed again by #181, residual
EXECUTED by #188, one NEW residual by receipt (#190's seam) ARMED as
c2-iter6 — the bench seats both its customers; §5 at refit 4; §8 at
refit 5 (#174); §6's one-transport question stays WATCH for want of
new evidence — its watch surface is authored (#190's per-unit pins),
evidence can only arrive at the real run); composite eval — the case
AUTHORED (#190, rail-side leg DONE), GREEN pending ONE receipted
seam: the real run dies at the coworker mint (j-5c1861) until
c2-iter6 folds it; then graduation = the ops-side real ≤30-min run,
and a green case graduates the loop to the FULL benchmark pass.

## The composite eval case — transfer-window-v2 (spec)

A real bench task, not a demo: deterministic offline player universe
(script-generated CSV fixture, no network), hard budget arithmetic, and
a verify.sh that CHECKS rather than vibes. Exercises every topology:

```
[[stage]] ingest      solo      normalize the fixture; check = jq schema
[[stage]] analyze     fan-out   3 position-group analysts (preamble +
                                 per-unit pins — cheap models here)
[[stage]] negotiate   coworker  DOF (initiates) + capologist reconcile
                                 the shards under the budget cap
[[stage]] scout       lab       actor-directed probes over the universe
                                 until a fit threshold (end detector)
[[stage]] grade       gate      verify.sh: budget arithmetic exact,
                                 coverage complete, no duplicate players,
                                 output schema valid — hard fails
```

Target ≤30 min real; mock rehearsal = seconds. LANDED as c2-iter5
(**#190**, 2026-10-20 — 682+/0− across 17 files, zero src: the
grammar's proof held; receipts #176/#183/#185 for the dialect it
authors in, #188 for the member court the negotiate stage rides,
#181 for the bench). The rehearsal seats both delegated stages
through the test suite's fake seams — GREEN, seconds, zero tokens;
the REAL ≤30-min bench run is ops-side (the driver's eval lane, as
topo-tune is), and it is now gated on ONE receipted seam, ARMED as
c2-iter6: the coworker child mint omits `kind` and the door —
correctly — refuses the minted child (j-5c1861; §2's block carries
the file:line receipts). The scope fence discharged its duty whole:
the declaration expressed the case with zero src changes, the
impossibility branch never fired, and the seam arrived as EVIDENCE
(#190's PR body), not as a silent src patch — fold it at the mint,
pin it where the lab pin lives, and the case is runnable real. After
a green real run: the FULL benchmark pass, a fresh commissioning.
