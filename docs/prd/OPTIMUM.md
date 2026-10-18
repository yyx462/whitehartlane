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

Empty quadrants (never explored — the fit cannot see them, so they are
listed instead): remote/multi-machine workers; a visual program
composer; hot-reload of a running chain; multi-tenant doors. Any of
these may be the true optimum's home; treat as research, not refit.

## L1 — components

### 1. Program grammar
- **Concept**: shape + hooks declared per stage; compiles to the
  fan-out core (units, waves, grade plan, pin plan).
- **Trajectory**: #5 one DAG file, tick-only scheduler → ADR 0007
  #42/#43/#50 settle-typed steps → ADR 0009 dag→spur rename →
  units-hook quick-mint (arm-e era) coexisting → #153–#158 stages
  (5 topologies, per-stage hooks, preamble, pins, manual).
- **Oscillation**: HIGH — three dialects for one concept; #150 (grade
  per unit) was the units-hook path's missing per-stage honesty.
  Resolved 2026-10-18: stages compile; steps+stages refused together.
- **Simpler alternative**: none pending — but the authoring surface is
  still three-shaped (stages, steps, units-hook). Retire the units-hook
  mint and fold `[[step]]` behind stages once levies migrate.
- **Verdict**: KEEP (converged). Next: LEVY-BRIEF mints `[[stage]]`.

### 2. Runner dispatch
- **Concept**: one door; dispatch by shape (members → coworker runner;
  kind=lab/live → lab runner; else fan-out); coworker/lab stages
  delegate as CHILD programs via the wake machinery.
- **Trajectory**: #3 name the orchestrator → #4 split lab from fan-out
  → #26 one shared host → #31 no mind runs a workflow → #153–156
  delegation rejoins the authoring surface without merging runners.
- **Oscillation**: MED (split → rejoin-via-delegation). The split was
  right at the runner level, wrong at the authoring level; delegation
  fixed the authoring.
- **Simpler alternative**: the three runners share Rail/panes/ledger —
  a single runner with kind-specific step execution would delete the
  dispatch layer. PRIME over-complication suspect.
- **Verdict**: INVESTIGATE (first redesign candidate for the loop).

### 3. Wake ladder
- **Concept**: one wake per commission; spool-first, per-rung trace.
- **Trajectory**: #25 in-band wake, nesting → #60 ADR 0008 spool →
  #95 ladder + fail button → #96/#97 fork-seed roots → #138 v2 plugin
  port.
- **Oscillation**: LOW (one softening: in-band → spool-first).
- **Simpler alternative**: none known.
- **Verdict**: KEEP.

### 4. Resume / parking
- **Concept**: drain to a boundary; park booked; resume from booked
  sessions; regrade is the minimal rerun (ADR 5).
- **Trajectory**: #16 pause/abort/continue → #18 session booking →
  #71/#72/#75 stall hearts, worktree ladder → #114–#116 bench-grade
  fleet → #145 grade contract + regrade.
- **Oscillation**: LOW; deepening honesty throughout.
- **Simpler alternative**: THREE state stores for a unit's lifecycle
  (checkpoints.jsonl cards, state.json, booked sessions) — consolidate?
- **Verdict**: INVESTIGATE (state-store consolidation).

### 5. Permissions
- **Concept**: privilege is rail-owned; sweep answers blocked panes;
  deny outranks roots; a dialog is progress.
- **Trajectory**: #6 → #14 → #29 → #33 → #38/#58 scratch → #71 sweep →
  #77 deny>roots → #83 path repair → #99 brownout.
- **Oscillation**: LOW-MED — the path pipeline stayed fix-dense
  (#29/#33/#83 all touch path judging).
- **Simpler alternative**: one canonical path predicate instead of
  roots + deny + normalization + pre-seed layers.
- **Verdict**: INVESTIGATE.

### 6. Model pinning
- **Concept**: nearest-declaration pins; budget ladder for refusals.
- **Trajectory**: CLI --model flag → #101 sandbox-config (opencode
  dropped the flag; panes died) → #136 router → #159 seam pins.
- **Oscillation**: HIGH historically (3 transport changes in ~2 weeks);
  #159 settles authoring; pane-path vs CLI-path asymmetry remains.
- **Simpler alternative**: ONE pin transport.
- **Verdict**: WATCH (freshly converged; let the loop exercise it).

### 7. Window
- **Concept**: viewer-only; static reloads, server bounces.
- **Trajectory**: #9→#12→#15→#19/#20 (v3→v5.1) → #59/#61 diagram →
  #69 no lane pane → #139 perf → #146 doorNowRev memoization.
- **Oscillation**: LOW — monotonic refinement.
- **Simpler alternative**: none pending.
- **Verdict**: KEEP.

### 8. Relay
- **Concept**: members' briefs + wire protocol; refusals speak;
  deliveries outlive memory.
- **Trajectory**: #10 born booked/fork/relay → #98 refusals speak →
  #122 transport retry → delegation #153+.
- **Oscillation**: LOW.
- **Simpler alternative**: relay ledger vs events vs checkpoints —
  overlapping persistent streams (consolidate with §4's stores?).
- **Verdict**: KEEP (watch the consolidation).

## The loop (non-stop)

1. **Refit** the affected L1 block from full history.
2. **Worst part** = highest oscillation × runtime loss (session logs).
   Replace the whole design — never patch inside it.
3. **Eval**: mock-rehearse the composite chain (seconds, zero tokens)
   + ONE real ≤30-min bench task exercising the redesign.
4. **Merge** → back to 1.

**Milestone (falsifiable)**: no component with unresolved reversal; no
component with a known-simpler alternative; composite eval green. Then
— and only then — the FULL benchmark pass.

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

Target ≤30 min real; mock rehearsal = seconds. Build next.
