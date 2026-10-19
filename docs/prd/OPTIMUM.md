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

The thesis held under refit 4: #172 executed the fold refit 3 had
named — §5 converged when privilege's last private path spelling moved
into the canonical predicate; no new axis appeared.

Empty quadrants (never explored — the fit cannot see them, so they are
listed instead): remote/multi-machine workers; a visual program
composer; hot-reload of a running chain; multi-tenant doors. Any of
these may be the true optimum's home; treat as research, not refit.

## L1 — components

Momentum table (`momentum.py`, 2026-10-20, 120-day window — whole-PR
churn attribution, coarse v1: wide globs catch shared-surface PRs, so
fix-density overcounts hub components; the pick rule is checkable and
holds — the worst tops its own table AFTER receipted discounts):

| component | fix-density | oscillation | churn | runtime-loss | score |
|---|---|---|---|---|---|
| runner-dispatch | 72 | 0 | 39713 | — | 111.7 |
| window | 27 | 0 | 16364 | — | 43.4 |
| permissions | 13 | 0 | 10717 | — | 23.7 |
| resume-parking | 3 | 0 | 1465 | — | 4.5 |
| wake-ladder | 1 | 0 | 1153 | — | 2.2 |
| model-pinning | 1 | 0 | 777 | — | 1.8 |
| relay | 0 | 0 | 0 | — | 0.0 |
| program-grammar | 0 | 0 | 0 | — | 0.0 |

Refit 4's pick reads the table after the discounts, every one by
receipt: rank 1 **runner-dispatch** (111.7) converged — its +1
fix-density IS #172's fold deleting `engine.ts`'s private roots.txt
reader (net-negative code: convergence churn, not sickness; a fixer
sent there would patch inside #170's converged design, the one move
the loop forbids); rank 2 **window** (43.4) unchanged since refit 3's
churn read — follower-dominated, #172 touched nothing under `web/`;
rank 3 **permissions** (23.7) converged THIS iteration (#172 closed
slice 2, the closing slice is the +1 itself); rank 4 **resume-parking**
converged (#162 one ledger, #170 the law reached the lab); rank 5
**wake-ladder** KEEP, no alternative known; rank 6 **model-pinning**
WATCH with no new evidence (3793ad1 bumped `bin/pick-workflow`'s jev
pin direct-to-master — config, not rail src). The pick is rank 7
**relay** — honestly OFF-TABLE (0.0: sickness metrics cannot see a
clean component's open mandate) and ON-BOOKS: the events fold #162
named is the last un-gated known-simpler alternative the milestone
forbids carrying. That is the discount chain's honest end: the table
is running out of sick components, which is the loop winning.

Attribution gaps (human note — the constitution is not refit's to
edit): `src/lab*` AND `src/store*` match no component's globs (#170
reached the table only via `rail.ts`/`engine.ts`; the coming fold's
`store.ts` work will do the same) — runner-dispatch should own
`src/lab*`, relay should own `src/store*` at the next constitution
touch. And the shared `engine.ts` surface double-bills permissions
work to runner-dispatch (again: #163, #172).

### 1. Program grammar
- **Concept**: shape + hooks declared per stage; compiles to the
  fan-out core (units, waves, grade plan, pin plan).
- **Trajectory**: #5 one DAG file, tick-only scheduler → ADR 0007
  #42/#43/#50 settle-typed steps → ADR 0009 dag→spur rename →
  units-hook quick-mint (arm-e era) coexisting → #153–#158 stages
  (5 topologies, per-stage hooks, preamble, pins, manual).
- **Oscillation**: HIGH historically — three dialects for one concept;
  #150 (grade per unit) was the units-hook path's missing per-stage
  honesty. Resolved 2026-10-18: stages compile; steps+stages refused
  together. Untouched by the loop so far (attribution 0 — grammar
  globs are narrow and true).
- **Simpler alternative**: the authoring surface is still three-shaped
  (stages, steps, units-hook). Retire the units-hook mint and fold
  `[[step]]` behind stages once levies migrate — and #167/#170 handed
  §1 one more debt when §2 closed: the runners' dialect surface folds
  into ONE authoring story here, now CONCRETE — `runLab` still carries
  the legacy spur path beside `[[stage]]` (#170's body names it).
- **Verdict**: KEEP (converged); the debt is stated and gated (levy
  migration), the next convergence item after §8's fold lands. Next:
  LEVY-BRIEF mints `[[stage]]`.

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
  this +1 to runner-dispatch; it is convergence churn).
- **Oscillation**: RESOLVED. The old MED (split → rejoin-via-
  delegation) dissolved monotonically: #161→#164→#167→#170→#172
  share one direction (dispatch machinery deleted, engines kept),
  zero reversal pairs — five slices, one line.
- **Simpler alternative**: NONE LEFT. The PRIME suspect ("a single
  runner with kind-specific step execution") is fully landed: one
  door, one chain object, one walker, three executors, the lab shape
  honors the same drain/resume law as its siblings, and the door now
  holds no path knowledge at all.
- **Verdict**: KEEP (converged at refit 3; #172 purified it further).
  The residual dialect surface (legacy spur path inside runLab) is
  §1's to retire.

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
  convention, with a production-silently-broken receipt) → #172 read
  the ledger untouched (the permissions slice stayed inside §5's
  surface).
- **Oscillation**: LOW; deepening honesty throughout.
- **Simpler alternative**: EXECUTED at the task-dir level. The
  three-stores sickness (checkpoints cards + state.json + booked
  sessions) is cured: one append-only ledger; booked sessions remain
  as a different aggregate (the JOB's lifecycle — L0 "paused is
  booked, not lost"), correctly not consolidated. ONE residual fold
  remains — retire `checkpoints.jsonl` itself into the OS-disk
  events trace — tracked under §8's mandate (this refit's pick),
  not §4's.
- **Verdict**: KEEP (converged).

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
  viewer-only line has held since #69. Refit 4: nothing new under
  `web/` — the read stands.
- **Verdict**: KEEP. Stays #2 on the table (43.4) by follower churn;
  not a candidate until a window-INTRINSIC question appears.

### 8. Relay
- **Concept**: members' briefs + wire protocol; refusals speak;
  deliveries outlive memory.
- **Trajectory**: #10 born booked/fork/relay → #98 refusals speak →
  #122 transport retry → delegation #153+ → #164 one booked-wait
  spelling (the dead member-nudge filter deleted with it) → **the
  events fold, picked at refit 4**: #162 named it; #172's convergence
  left it the LAST un-gated known-simpler alternative on the books.
  The evidence on master: `checkpoints.jsonl` is a duplicate carded
  store — `orchestrator.ts`'s own comment concedes the stage ledger
  "carries the same cards with timestamps" the OS-disk trace already
  holds, and `store.ts` owns that trace (`sessionDir(sid)/
  events.jsonl`).
- **Oscillation**: LOW.
- **Simpler alternative**: THE PICK. Slice, stated: retire the
  task-dir `checkpoints.jsonl` into the OS-disk `events.jsonl`; the
  task dir keeps only the delivery interface. The seam is
  `state.ts`'s card functions (`checkpoint`/`settle`/`readState`/
  `readCheckpoints`): hold the interface and the five readers
  (orchestrator, orchestrator-chain, front-door, rail, resume) stay
  untouched — the tests that read the file directly (chain,
  orchestrator, regrade, stages) do change.
- **Verdict**: INVESTIGATE (refit 4's pick: NEXT-TARGET relay, cap
  700 — widened from the 500 default for the cross-surface fold —
  blast set = the store seam + the trace owner + the component's own
  surface + the five readers as contingent + test/ + docs).

## The loop (non-stop)

1. **Refit** the affected L1 block from full history.
2. **Worst part** = highest oscillation × runtime loss (session logs).
   Replace the whole design — never patch inside it.
3. **Eval**: mock-rehearse the composite chain (seconds, zero tokens)
   + ONE real ≤30-min bench task exercising the redesign.
4. **Merge** → back to 1.

Loop-v2 status (refit 4's read): three iterations landed GREEN — #167
(iteration 1), #170 (iteration 2), #172 (iteration 3: receipt 1
fixer round; one eval-red bounce root-caused as INFRA — the 18:18
landing eval died inside zhipuai's 5-hour quota window ('已达到 5
小时的使用上限') with no RESULT.md, the same eval had PASSed 5× that
day, the fixer changed nothing and re-proved topo-tune directly GREEN
(33,8); regate PASS 00:24, merged). strikes.json {} — no same-cause
strike ever billed; D3 unexercised (a circuit breaker, not a KPI).
#169 (operator amendment) made refit proposals effective as-written,
which raises this file's duty: the discount chain and pick receipts
above ARE the audit trail that keeps D2 honest — momentum.py's
mechanical rank-1 echo (runner-dispatch, cap 900) was read and
overridden BY RECEIPT, not by taste.

**Milestone (falsifiable)**: no component with unresolved reversal
(✓ — oscillation 0 across the table); no component with a
known-simpler alternative (§2 closed at refit 3; §5 closed at refit
4; §8's fold is this refit's pick — the last un-gated one; §1's
retirement debt stays GATED on levy migration; §6's one-transport
question stays WATCH for want of new evidence); composite eval green.
After §8: the composite eval case is the milestone's remaining
unbuilt leg — and with every component converged-or-gated, a green
eval case graduates the loop to the FULL benchmark pass.

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
real levy, joint target (33,8) green on #167, #170, and #172's
re-proof). #170 makes the scout stage honest to bench: a
paused-and-continued lab now resumes rather than restarts, so the
≤30-min budget survives human interference. #172 is eval-adjacent
only in that the fixture's `roots.txt` rides the now-canonical
predicate.
