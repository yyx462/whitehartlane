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
> third loop-v2 iteration, GREEN the hard way: the 18:18 landing eval
> died red inside zhipuai's 5-hour quota window with no RESULT.md, the
> fixer's bounce record root-caused it as INFRA with the branch
> untouched, topo-tune re-proven directly, regate PASS 00:24, merged).
> No same-cause strike ever billed (strikes.json {}); no ESCALATED
> records; D3 unexercised.
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

The thesis held under refit 6: #176 executed §1's slice 1 — a dialect
died by refusal (`[[step]]` tables and the units-hook quick-mint now
answer "use [[stage]]", the door refuses a stage-less fan-out manifest
before booking) and no new axis appeared. Deletion as convergence: the
PR is 650 lines gone, 250 added, tests 437 green.

Empty quadrants (never explored — the fit cannot see them, so they are
listed instead): remote/multi-machine workers; a visual program
composer; hot-reload of a running chain; multi-tenant doors. Any of
these may be the true optimum's home; treat as research, not refit.

## L1 — components

Momentum table (`momentum.py`, 2026-10-20, 120-day window — whole-PR
churn attribution, coarse v1: attribution uses component-owned globs
only, test/ and docs/ excluded; §1's default globs match no file at
all — see the gaps note below):

| component | fix-density | oscillation | churn | runtime-loss | score |
|---|---|---|---|---|---|
| runner-dispatch | 74 | 0 | 40928 | — | 114.9 |
| window | 27 | 0 | 16364 | — | 43.4 |
| permissions | 13 | 0 | 10717 | — | 23.7 |
| resume-parking | 4 | 0 | 1780 | — | 5.8 |
| wake-ladder | 1 | 0 | 1153 | — | 2.2 |
| model-pinning | 1 | 0 | 777 | — | 1.8 |
| relay | 0 | 0 | 0 | — | 0.0 |
| program-grammar | 0 | 0 | 0 | — | 0.0 |

Refit 6's pick reads the table after the discounts, every one by
receipt: rank 1 **runner-dispatch** (114.9) converged — its +1/+900 IS
#176 billing through orchestrator.ts (8 lines: the door resolving steps
ONLY from stages) while the dialect surface itself (hooks.ts −153,
run.ts +14) is unattributed — the attribution gap's cleanest receipt
yet: the DIALECT RETIREMENT bills 0.0 to program-grammar; rank 2
**window** (43.4) unchanged since refit 3's churn read — #176 touched
nothing under `web/` (ADR 0014 pins the viewer's own `[[step]]`
renderer for HISTORICAL run dirs — history, not authoring); rank 3
**permissions** (23.7) converged at refit 4 (#172); rank 4
**resume-parking** (5.8) converged (#174 closed its named residual
fold); rank 5 **wake-ladder** KEEP, no alternative known; rank 6
**model-pinning** WATCH, no new evidence. Rank 7 **relay** (0.0)
converged (#174). The pick is rank 8 **program-grammar** — 0.0 on the
table (narrow globs matching no code file) and HALF-EXECUTED: #176
landed slice 1 of the one-authoring-story retirement (ADR 0014
records the split the landing PR stated); slice 2 — the legacy lab
program path — is the remaining half of the LAST un-gated
known-simpler alternative on the books. The milestone forbids carrying
it; the pick completes what refit 5 armed.

Attribution gaps (human note — the constitution is not refit's to
edit): `src/lab*` and `src/store*` match no component's globs, and §1's
defaults (`src/stage*`, `src/parse*`) match no FILE — the dialects
parse inside `src/hooks.ts`, and the legacy lab path lives in
`src/run.ts`/`src/lab.ts`/`src/spur.ts`, all unattributed. Proof by
receipt, twice over: #174 (the relay fold) bills its churn to
resume-parking (state.ts) and runner-dispatch (orchestrator.ts) while
store.ts lands on nobody; #176 (the grammar retirement itself) bills
its whole 900 to runner-dispatch through 8 lines of orchestrator.ts
while hooks.ts/run.ts — the entire dialect surface — bill 0.0 to
§1. At the next constitution touch: relay should own `src/store*`,
program-grammar should own `src/hooks.ts` + `src/run.ts` (the
authoring dialects), runner-dispatch `src/lab*`. And the shared
`engine.ts` surface still double-bills permissions work to
runner-dispatch (#163, #172).

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
  stages — internal, never authored.
- **Oscillation**: HIGH historically — three dialects for one concept;
  #150 (grade per unit) was the units-hook path's missing per-stage
  honesty. Resolving monotonically: #176 deleted dialect code (−650)
  with zero reversal pairs. Zero attribution ever — the globs own no
  code file.
- **Simpler alternative**: slice 2 — the named second half (ADR 0014
  §3, stated in the landing PR): retire the legacy lab program path.
  run.ts `prepareLabRun` stops admitting spur.mjs/dag.mjs; lab.ts's
  spur branch goes (the lab stage chain drives the actor, as
  wake-steps.test.ts already demonstrates); spur.ts's ADR-0009 step
  scheduler is deleted whole (238 lines — stage executors leave it
  consumer-less); `[gates]` detector plumbing retires with the step
  gates it served (stages bind verify.sh — #150); the e2e battery
  (8 programs, still `[[step]]`/`hooks.units`/`[report]`-shaped
  museum pieces that would be REFUSED if fired today) converts to
  stage chains; `examples/`-spurs retire with them. docs/STAGES.md is
  the surviving manual; ADR 0014 flips to executed.
- **Verdict**: INVESTIGATE (refit 6's pick: NEXT-TARGET
  program-grammar slice 2, cap 1000 — blast set = the dialect owners
  (spur.ts, lab.ts, run.ts, hooks.ts) + the chain seam as contingent
  (orchestrator*, workflow-kind) + e2e/examples + STAGES.md/RAILS.md/
  adr/prd + test/).

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
  lines; the table's +1/+900 bills here — the door holding the seam
  again, convergence churn not sickness).
- **Oscillation**: RESOLVED. The old MED (split → rejoin-via-
  delegation) dissolved monotonically: #161→#164→#167→#170→#172
  →#176 share one direction (dispatch machinery deleted, engines
  kept), zero reversal pairs — six slices, one line.
- **Simpler alternative**: NONE LEFT. The PRIME suspect ("a single
  runner with kind-specific step execution") is fully landed: one
  door, one chain object, one walker, three executors, the lab shape
  honors the same drain/resume law as its siblings, and the door now
  holds no path knowledge at all.
- **Verdict**: KEEP (converged at refit 3; #172/#174/#176 purified it
  further). The residual dialect surface (the legacy spur path inside
  the lab door) is §1 slice 2's to retire — the next commissioning's
  target.

### 3. Wake ladder
- **Concept**: one wake per commission; spool-first, per-rung trace.
- **Trajectory**: #25 in-band wake, nesting → #60 ADR 0008 spool →
  #95 ladder + fail button → #96/#97 fork-seed roots → #138 v2 plugin
  port → #164 spawn failures arm 30s retries via the ladder (unborn
  workers leave the stall ladder's jurisdiction, #166).
- **Oscillation**: LOW (one softening: in-band → spool-first).
- **Simpler alternative**: none known.
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
  unchanged; ADR 0013).
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
  the door's included); tests re-pinned at the new seam.
- **Oscillation**: LOW-MED historically — the fix-density was the
  symptom; both slices landed without reversal (the 12→13 delta is
  the closing slice itself).
- **Simpler alternative**: EXECUTED. The design record's closing
  condition holds on master: `permission.ts` is the component's only
  path knowledge.
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
  viewer-only line has held since #69. Refits 4–6: nothing new under
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
  strikes, eval green (33,8)).
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

Loop-v2 status (refit 6's read): five iterations landed GREEN — #167
(iteration 1), #170 (iteration 2), #172 (iteration 3: one eval-red
bounce root-caused INFRA — zhipuai's 5-hour quota window, re-proven
direct, regate PASS), #174 (iteration 5: 1 round, 0 strikes, clean),
#176 (iteration 6: 1 round, 0 strikes, cap 900 = diff exactly,
topo-tune green (33,8)). Iteration 4 died driver-side (DEAD-iter4:
driver death mid-flight, revive4's adopted fixer failed — never a
gate-red round, never a strike; D4's boundary held). Every refit PR
absorbed except one (#173's absorb was refused once by the refit
lane's evidence fence — body must cite ≥2 PR refs, this file's own
authors must comply — and human-merged; #175 absorbed clean).
strikes.json {} — no same-cause strike ever billed; D3 unexercised (a
circuit breaker, not a KPI). #169 (operator amendment) made refit
proposals effective as-written, which raises this file's duty: the
discount chain and pick receipts above ARE the audit trail that keeps
D2 honest — momentum.py's mechanical rank-1 echo (runner-dispatch,
cap 900) was read and overridden BY RECEIPT, not by taste, four
refits running. The MAX-6 commissioning budget is CONSUMED (six
iterations billed: 1, 2, 3, 4-dead, 5, 6): slice 2 arms under a
FRESH commissioning on refit 6's NEXT-TARGET (§1, cap 1000); after it
lands, the milestone's remaining leg (the composite eval case) is a
BUILD — and the eval lane itself is constitution: the operator points
it at the new case.

**Milestone (falsifiable)**: no component with unresolved reversal
(✓ — oscillation 0 across the table); no component with a
known-simpler alternative (§2 closed at refit 3; §5 at refit 4; §8 at
refit 5 (#174); §1 HALF-closed at #176 — slice 2 is the next
commissioning's first target, the last open alternative on the books;
§6's one-transport question stays WATCH for want of new evidence);
composite eval green. After §1 slice 2: the composite eval case is
the milestone's last unbuilt leg — a green eval case graduates the
loop to the FULL benchmark pass.

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
#174, and #176). #170 makes the scout stage honest to bench: a
paused-and-continued lab now resumes rather than restarts, so the
≤30-min budget survives human interference. Sequencing held by refits
5–6: §1's retirement (slice 1 landed #176; slice 2 next) lands BEFORE
the case is authored, so the case authors against the final
one-dialect grammar.
