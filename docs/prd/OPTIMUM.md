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

The thesis held under refit 3: #170 executed the alternative refit 2
had already named (lab pause parity, ADR 5 for the last shape); no new
axis appeared. One thesis-level note hardened: "paused is booked, not
lost" is now true of ALL three shapes, not a fan-out/coworker privilege.

Empty quadrants (never explored — the fit cannot see them, so they are
listed instead): remote/multi-machine workers; a visual program
composer; hot-reload of a running chain; multi-tenant doors. Any of
these may be the true optimum's home; treat as research, not refit.

## L1 — components

Momentum table (`momentum.py`, 2026-10-19, 120-day window — whole-PR
churn attribution, coarse v1: wide globs catch shared-surface PRs, so
fix-density overcounts hub components; the pick rule is checkable and
holds — the worst tops its own table):

| component | fix-density | oscillation | churn | runtime-loss | score |
|---|---|---|---|---|---|
| runner-dispatch | 71 | 0 | 39568 | — | 110.6 |
| window | 27 | 0 | 16364 | — | 43.4 |
| permissions | 12 | 0 | 10572 | — | 22.6 |
| resume-parking | 3 | 0 | 1465 | — | 4.5 |
| wake-ladder | 1 | 0 | 1153 | — | 2.2 |
| model-pinning | 1 | 0 | 777 | — | 1.8 |
| relay | 0 | 0 | 0 | — | 0.0 |
| program-grammar | 0 | 0 | 0 | — | 0.0 |

Refit 3's pick reads the table with the two documented discounts, both
by receipt: rank 1 **runner-dispatch** converged THIS iteration (#170
closed its last stated slice — a fixer sent there now would patch
inside a converged design, the one move the loop forbids); rank 2
**window** was read as refit 2 instructed and its churn decomposes
follower-dominated — #145 (+697 grade-contract rendering), #162
(+230 ledger read), #139 (+241 scan perf) all land in `web/server.mjs`
as the rendering of rail-side redesigns; window-owned churn is small
monotonic polish. The pick is rank 3 **permissions**: the highest-
scored component with an open redesign mandate (INVESTIGATE verdict +
a stated slice in a design record). Attribution gap noted for the
human (constitution is not refit's to edit): `src/lab*` matches no
component's globs — #170's churn reached the table only via
`rail.ts`/`engine.ts`; runner-dispatch's blast set carried `src/lab*`
ad hoc in refit 2 and should own it in `components.json` at the next
constitution touch.

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
  migration), the next convergence item after §5 closes. Next:
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
  with a live probe receipt).
- **Oscillation**: RESOLVED. The old MED (split → rejoin-via-
  delegation) dissolved monotonically: #161→#164→#167→#170 share one
  direction (dispatch machinery deleted, engines kept), zero
  reversal pairs — four slices, one line.
- **Simpler alternative**: NONE LEFT. The PRIME suspect ("a single
  runner with kind-specific step execution") is fully landed: one
  door, one chain object, one walker, three executors, and the lab
  shape now honors the same drain/resume law as its siblings.
- **Verdict**: KEEP (converged at refit 3). The residual dialect
  surface (legacy spur path inside runLab) is §1's to retire.

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
  convention, with a production-silently-broken receipt).
- **Oscillation**: LOW; deepening honesty throughout.
- **Simpler alternative**: EXECUTED. The three-stores sickness
  (checkpoints cards + state.json + booked sessions) is cured at the
  task-dir level: one append-only ledger; booked sessions remain as
  a different aggregate (the JOB's lifecycle — L0 "paused is booked,
  not lost"), correctly not consolidated.
- **Verdict**: KEEP (converged). Residual fold (checkpoints.jsonl →
  OS-disk events.jsonl) is tracked under §8's watch, not §4's.

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
  record's "bins' 16-line readers" folded into `programRootsOf`) —
  refit 3 re-read the surface: exactly TWO roots.txt spellings remain
  (`src/permission.ts:readRootsTxt` canonical vs
  `src/engine.ts:programRootsOf` private), and `sanitizeRoots` is
  still an export with a test pinning it.
- **Oscillation**: LOW-MED historically — the fix-density was the
  symptom; slice 1 landed without reversal.
- **Simpler alternative**: slice 2, restated in its current shape:
  fold `programRootsOf` onto `readRootsTxt`/`scopeFromDir` (the loud
  hard-deny strip + warning moves into the canonical predicate),
  retire the `sanitizeRoots` export. Then the component's only path
  knowledge lives in `permission.ts` and §5 converges — the design
  record's own closing condition.
- **Verdict**: INVESTIGATE (one stated slice remains — refit 3's
  pick: NEXT-TARGET permissions, cap 600, blast set narrowed to the
  true surface `src/permission.ts` + `src/engine.ts` + test/ + the
  design record).

### 6. Model pinning
- **Concept**: nearest-declaration pins; budget ladder for refusals.
- **Trajectory**: CLI --model flag → #101 sandbox-config (opencode
  dropped the flag; panes died) → #136 router → #159 seam pins.
- **Oscillation**: HIGH historically (3 transport changes in ~2 weeks);
  #159 settles authoring; pane-path vs CLI-path asymmetry remains.
- **Simpler alternative**: ONE pin transport.
- **Verdict**: WATCH (freshly converged; the loop has not touched it
  since — one attribution, #159's tail).

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
  viewer-only line has held since #69.
- **Verdict**: KEEP. Stays #2 on the table (43.4) by follower churn;
  not a candidate until a window-INTRINSIC question appears.

### 8. Relay
- **Concept**: members' briefs + wire protocol; refusals speak;
  deliveries outlive memory.
- **Trajectory**: #10 born booked/fork/relay → #98 refusals speak →
  #122 transport retry → delegation #153+ → #164 one booked-wait
  spelling (the dead member-nudge filter deleted with it).
- **Oscillation**: LOW.
- **Simpler alternative**: relay ledger vs events vs checkpoints —
  now CONCRETE: #162 names the fold (retire checkpoints.jsonl into
  the OS-disk events.jsonl; the task dir keeps only the delivery
  interface).
- **Verdict**: KEEP (watch the fold).

## The loop (non-stop)

1. **Refit** the affected L1 block from full history.
2. **Worst part** = highest oscillation × runtime loss (session logs).
   Replace the whole design — never patch inside it.
3. **Eval**: mock-rehearse the composite chain (seconds, zero tokens)
   + ONE real ≤30-min bench task exercising the redesign.
4. **Merge** → back to 1.

Loop-v2 status (refit 3's read): two iterations landed GREEN — #167
(iteration 1) and #170 (iteration 2, receipt 1 round / 0 strikes / no
gate-error, topo-tune green on the joint target (33,8)). No strikes
ledger exists (nothing has escalated; D3's cure remains unexercised,
which is fine — it is a circuit breaker, not a KPI). #169 (operator
amendment) removed the refit signature gate and permitted immediate
chaining — refit proposals now take effect as-written, which raises
this file's duty: the discounts and pick receipts above are the audit
trail that keeps D2 honest.

**Milestone (falsifiable)**: no component with unresolved reversal; no
component with a known-simpler alternative; composite eval green. Then
— and only then — the FULL benchmark pass. §2 closed at refit 3 (the
second INVESTIGATE closed by the loop); §5 is one stated slice from
closing and is this refit's pick; §1's retirement debt is stated but
gated on levy migration; §8's fold stays on watch. After §5: the
composite eval case is the milestone's remaining unbuilt leg.

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
real levy, joint target (33,8) green on #167 and #170). #170 makes the
scout stage honest to bench: a paused-and-continued lab now resumes
rather than restarts, so the ≤30-min budget survives human interference.
