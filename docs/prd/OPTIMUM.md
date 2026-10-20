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

The thesis held under refit 9, and §1's three-slice run is its cleanest
proof: #176 refused the retired spellings at the door, #183 deleted the
engine, #185 converted the corpus — one authoring story, everywhere a
program can be authored, pinned by a test (corpus.test.ts) so a future
museum donation cannot land. The direction since #176 is one line; no
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
package-by-feature move and now match almost nothing — see the gaps
note below):

| component | fix-density | oscillation | churn | runtime-loss | score |
|---|---|---|---|---|---|
| runner-dispatch | 79 | 0 | 44456 | — | 123.5 |
| window | 27 | 0 | 16364 | — | 43.4 |
| permissions | 13 | 0 | 10717 | — | 23.7 |
| resume-parking | 5 | 0 | 2473 | — | 7.5 |
| wake-ladder | 1 | 0 | 1153 | — | 2.2 |
| model-pinning | 1 | 0 | 777 | — | 1.8 |
| relay | 0 | 0 | 0 | — | 0.0 |
| program-grammar | 0 | 0 | 0 | — | 0.0 |

The table is BYTE-IDENTICAL to refit 8's — and that identity is a
receipt, not a stall: #185 was 103 files, 1805 diff lines, and ZERO
src files (authoring-side only, exactly as its blast set promised),
so it bills to no component under the src-only globs. Refit 9's pick
reads the table after the discounts, every one by receipt: rank 1
**runner-dispatch** (123.5) — for the SEVENTH consecutive refit the
arithmetic is the seam's echo (43465 at refit 7, +991 of #183 mis-
billed whole through src/engines/lab.ts, +0 since) — but this refit
PICKS it for the first time, because the component's own block now
holds exactly ONE named residual and it lives in this seam:
coworker-run.ts's hand-rolled nudge ladder, the bench's second
customer (#181's stated next slice; the bench itself — benchOrder/
applyRuling — sits one file over in src/engines/orchestrator.ts).
Six reads overridden (refits 3–8), one pick narrowed by receipt: the
echo churn is the seam's, and the residual is the seam's one open
customer. Rank 2 **window** (43.4) unchanged since refit 3's churn
read — nothing under `web/` since. Rank 3 **permissions** (23.7)
converged (#172). Rank 4 **resume-parking** (7.5) frozen. Rank 5
**wake-ladder** KEEP. Rank 6 **model-pinning** WATCH. Rank 7 **relay**
(0.0) converged (#174). Rank 8 **program-grammar** — 0.0 on the
table forever (its globs own no code file) — is CLOSED at this refit:
§1 converged on its named target (#185), the milestone's last gated
alternative off the books.

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
(no src file in a 103-file PR; the table unchanged is the receipt).
At the next constitution touch: re-path the globs onto the package
layout — program-grammar should own `src/doors/{hooks,run,spur}.ts`,
relay `src/adapters/store.ts`, resume-parking `src/core/state.ts`,
permissions `src/core/permission.ts`, wake-ladder
`src/adapters/wake*`, runner-dispatch `src/engines/*`.

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
- **Oscillation**: RESOLVED — the whole three-slice run was monotone
  deletion: #176 (250+/650−), #183 (93+/898−), #185 (369+/1436−);
  zero reversal pairs across all three. Zero attribution ever — the
  globs own no code file (#183's doors/* deletions and #185's whole
  103 files both bill 0.0, the gaps note's receipts).
- **Simpler alternative**: EXECUTED — the milestone's last GATED
  alternative closed by #185. One NEW finding on the books (recorded
  in ADR 0014, #185's PR body): the delegation boundary cannot carry
  task-level detector/hook files — inbox-zero's world-sourced signal,
  human veto, and reject-requeue rode files a minted child cannot
  hold. Research, not a sickness: no design on the books claims it
  should; if it becomes wanted, it is a declaration-capability
  question (an empty-quadrant entry), not a reversal of this one.
- **Verdict**: KEEP (converged at refit 9 — receipts #176, #183,
  #185; ADR 0014 EXECUTED).

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
  not this component's work either (zero src files; bills nothing).
  The seam echoes, it does not sicken — and it holds ONE open
  customer: coworker-run.ts's nudge ladder.
- **Oscillation**: RESOLVED. Zero reversal pairs — EIGHT slices on
  one line (#161→#164→#167→#170→#172→#176→#181, plus the seam-echo
  billings #183/#185). But refit 6's "simpler alternative: NONE
  LEFT" was FALSIFIED: #178/#179 minted one (a new observation verb
  + a new settle lane made a bench-shaped replacement visible) and
  #181 landed it. Lesson carried into every future "none left": the
  claim is about the CURRENT seam's shape, not about the component.
- **Simpler alternative**: ONE named residual, UNGATED, now ARMED
  (refit 9's pick, c2-iter4): coworker-run.ts's nudge ladder is the
  bench's second customer (#181's stated next slice). Live on master:
  src/engines/coworker-run.ts (565 lines) hand-rolls its member
  stall court — the `nudged` map, the 2-nudge cap, the deferred kill
  at queued guidance, the bespoke dead-record close — one file over
  from the bench it predates (benchOrder/applyRuling in
  src/engines/orchestrator.ts), pinned by test/coworker-run.test.ts
  ("tests drive the nudge ladder in milliseconds"). Extension-shaped
  (a fold onto the landed bench), not a reversal; the sequencing
  constraint (AFTER §1's museum slice, which carried the milestone's
  gate) is DISCHARGED by #185.
- **Verdict**: KEEP (the replacement landed; the residual is a fold,
  not a sickness — and it is now the loop's armed line).

### 3. Wake ladder
- **Concept**: one wake per commission; spool-first, per-rung trace.
- **Trajectory**: #25 in-band wake, nesting → #60 ADR 0008 spool →
  #95 ladder + fail button → #96/#97 fork-seed roots → #138 v2 plugin
  port → #164 spawn failures arm 30s retries via the ladder (unborn
  workers leave the stall ladder's jurisdiction, #166) → #178/ADR
  0015: `WakeBooking.parentUnit` + `spawnerSession` make the wait-for
  DAG receipt-backed; `waitingOnLiveChild` folds dangling edges to
  "not a wait"; declared follow-up — the event-driven wake
  (`herdr agent wait --until idle`) so the settle fires on the
  transition instead of the next beat.
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
  the door's included); tests re-pinned at the new seam. Refits 4–9:
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
  1.13→1.14 — config churn only, no rail src, no attribution.
- **Oscillation**: HIGH historically (3 transport changes in ~2 weeks);
  #159 settles authoring; pane-path vs CLI-path asymmetry remains.
- **Simpler alternative**: ONE pin transport — directional only; it
  becomes a milestone violation the moment new evidence arrives, and
  none has (#159 is the last rail touch; the loop never followed).
  Watch item for c2-iter4: the armed fold's file
  (src/engines/coworker-run.ts) imports the jev model-ladder seam
  (budgetAction/nextModel) — if the fold surfaces pane-path pin
  evidence, this block re-opens on receipt, not on taste.
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
  viewer-only line has held since #69. Refits 4–9: nothing new under
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

Loop-v2 status (refit 9's read): EIGHT loop-era slices landed GREEN —
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
strike). Iteration 4 of commissioning 1 died driver-side (DEAD-iter4).
Commissioning 1's MAX-6 budget consumed; commissioning 2 (pin
335bbca) has THREE clean iterations banked (budget 3/6), and this
refit (c2-iter3's) arms §2's residual fold for c2-iter4. Every refit
PR absorbed except one (#173's absorb was refused once by the refit
lane's evidence fence — body must cite ≥2 PR refs, this file's own
authors must comply — and human-merged; #175, #177, #182, #184
absorbed clean, #184 in 44s). No strikes file exists — no same-cause
strike ever billed; D3 unexercised (a circuit breaker, not a KPI).
#169 (operator amendment) made refit proposals effective as-written,
which raises this file's duty: the discount chain and pick receipts
above ARE the audit trail that keeps D2 honest — momentum.py's
mechanical rank-1 echo (runner-dispatch) was read and overridden BY
RECEIPT, not by taste, SIX refits running (3–8); refit 9 is the
first to PICK the rank-1, and the receipt narrows the pick to the
component's one named residual (the echo churn is the seam's; the
residual is the seam's one open customer — the same narrowing, now
pointing AT the pick instead of away from it).

**Milestone (falsifiable)**: no component with unresolved reversal
(✓ — oscillation 0 across the table); no component with a
known-simpler alternative (§1 CLOSED at refit 9 — #176 slice 1, #183
the engine half, #185 the museum, ADR 0014 EXECUTED; §2 closed at
refit 3, re-opened by #178/#179, closed again by #181 — its ONE
UNGATED residual fold armed as c2-iter4; §5 at refit 4; §8 at refit
5 (#174); §6's one-transport question stays WATCH for want of new
evidence); composite eval green — NOT YET: the transfer-window-v2
case is the milestone's last unbuilt leg, and its crib (a converted,
corpus.test.ts-pinned stage-chain corpus demonstrating every
topology) landed with #185. After the residual fold: a green eval
case graduates the loop to the FULL benchmark pass.

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

Target ≤30 min real; mock rehearsal = seconds. Still build-next —
untouched by the loop so far (the loop's eval lane used topo-tune's
real levy, joint target (33,8) green on #167, #170, #172's re-proof,
#174, #176, #181, #183, and #185). #170 makes the scout stage honest
to bench: a paused-and-continued lab now resumes rather than restarts,
so the ≤30-min budget survives human interference; #178's platform
pen gives the case's lab stage a status-first settle lane if it
wants it (declared, not assumed); #183 removed the last engine-side
dialect and #185 converted the corpus, so the case authors against
`[[stage]]` only — with a converted, pinned example corpus to crib
from (every topology demonstrated: solo smoke, fan-out+preamble
staged-waves, gate waves/two-signoffs, coworker nested/hand-off, lab
with inline detectors git-wave/trivia-bench), not museum pieces.
Sequencing held by refits 5–9 and extended one step: §1's retirement
(#176, #183, #185) landed BEFORE the case is authored; the residual
fold (c2-iter4) lands before it too — the case's `negotiate` stage
is a coworker exchange, and it should author against the bench-owned
close ceremony, not a hand-rolled nudge ladder that is about to be
folded away underneath it.
