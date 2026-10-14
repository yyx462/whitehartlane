# Eval plan — agentic-os vs the single agent

One-shot plan page: what we will measure, how, and what would falsify the
README's stance. Regenerated per program phase; never a status board.
Benchmarks are surveyed in `docs/research/eval-landscape.md`; the design
bets' literature trail is `docs/research/papers.md`. Read those first.

## 0. The instrument problem, stated once

agentic-os is not an agent. Evaluating it model-vs-model is a category
error: the model is the same in both arms, the harness (opencode or pi)
is the same in both arms. What differs is **who runs the loop** — one
agent in its normal chat, or a deterministic supervisor that books
panes, relays typed messages, retries refusals, answers permission
asks, and wakes you once. So the eval measures the *supervision*, along
four topologies:

- **T1 — fleet over instances (fan-out).** N benchmark instances, one
  unit each; workers solve in parallel panes; grade is the benchmark's
  official checker. Baseline: the same CLI solving the same instances
  sequentially under the benchmark's official runner.
  Measures throughput, unattended completion, per-instance parity.
  Honest limit: the split was written by a person — no mind ever chose
  it. T1 tests the rails, never the product's cognitive bet.
- **T2 — decomposition of one task (coworker).** One benchmark task,
  named members with partitioned roots exchanging typed messages.
  Baseline: one agent, same model, same budget cap.
  Measures whether structure+isolation helps, hurts, or is orthogonal.
- **T2′ — the levy seat (decomposition BY an agent).** The seat the
  product story actually lives in: an entry agent — same model, same
  CLI — given the skill (a pinned prompt, not code) and the task,
  free to route: direct, fan-out, coworker. Its own planning tokens
  count against the same budget; one wake returns; it assembles.
  The seat exists three ways today (the `units` planner hook, the lab
  actor writing protocol.json, a whl levy commissioning a spur) — pick
  one chassis per pass, A/B the seats later. agentic-os alone is a
  supervisor; the treatment here is the SYSTEM: model + skill + rails.
- **T3 — rails around one agent.** The same single-agent task run bare,
  and run under a slots=1 job (retry cap, backpressure, typed
  permissions). Baseline: bare. Measures the rail's own effect on
  completion and reliability, with no multi-agent variable at all.

Everything else in this plan is one of those four topologies on a
famous benchmark, plus two instruments no famous benchmark ships:
attention accounting (§4) and the distillation curve (§5).

## 1. Hypotheses — pre-registered, falsifiable

Written before any run. Each names its topology and its metric. The
README makes no claim that several agents beat one; H1 is genuinely
open, and the literature (`docs/research/papers.md` §E) predicts
decomposition often hurts. The program is built to detect that honestly.

| # | Hypothesis | Topology | Metric | Falsified if… |
|---|---|---|---|---|
| H1 PARITY | Per-instance success under the OS is statistically indistinguishable from the single agent (same model, same CLI) | T1, T2 | benchmark-native success, paired per-instance (McNemar p<0.05) | OS success significantly below baseline |
| H2 DISTILL | One traced run, manually distilled, completes the same task set at a fraction of the first run's tokens, at ≥ first-run success | T1 | tokens (usage extractor), success | second run ≥ 67% of first-run tokens, or success drops |
| H3 ATTENTION | OS arms finish unattended: zero person-typed interventions; baseline arms require error-turn resend or babysitting | T1, T3 | interventions/task, unattended completion rate, wake count (≤1 by construction) | any person-typed rescue inside an OS arm, or baseline needs none either |
| H4 WALLCLOCK | N independent instances at slots=k finish in ≤ (N/k)·t_single·1.4 | T1 | events.jsonl `job.born`→`job.retired` | median fleet wall-clock above the bound at k=2 |
| H5 ISOLATION | Coworker members never read outside their roots (zero cross-root accesses), at success ≥ baseline − 5 pts on partitioned tasks | T2 | permission events + canary probe + success | any cross-root read, or success collapses under partitioning |
| H6 RAIL | Provider refusals and pane deaths recover without a person inside the caps; pass^k variance no worse than bare | T3 | `backpressure` events→recovered, pass^k over k=3 | an unrecovered refusal/stranded pane the rail papers over silently |
| H7 ROUTING | Given the skill, the entry agent routes by task shape: direct on single-shot work, spurs on decomposable work — and its choices are visible in the trace | T2′ | workflow-choice distribution per task class; direct-share on short tasks | routing is uniform (the skill doesn't read shape) or spurs everywhere (fashion over fit) |

## 2. Arms and the paired protocol

Four arms, all on the same machine (macOS), all recorded:

| Arm | Loop | Who retries | Panes |
|---|---|---|---|
| A — bare | single agent, benchmark's official runner | the harness / the person | 0 (headless or one terminal) |
| B — rail | single agent under a slots=1 job | the rail | 1 |
| C — fleet | fan-out, one unit per instance | the rail | k |
| D — cowork | coworker, members partitioned by task structure | the rail | members |
| E — levy | entry agent + pinned skill prompt; may route direct/fan-out/coworker; its own tokens count | the rail, behind whichever workflow it picks | its choice |

Arm D exists only where the task genuinely partitions (T2); arms A–C
apply everywhere. Arm E is the system-as-sold: the skill is the only
difference from arm A besides the rails, so **the skill prompt is part
of the treatment** — its commit hash is pinned in the manifest next to
the model id, and it changes only with a pass restart.

Pairing rules — any violation voids the pair:

1. **Iso-model**: same provider, model id, and snapshot, pinned and
   recorded per program; a provider-side model change freezes the phase.
2. **Iso-harness**: same worker CLI binary and version in every arm; the
   OS adds no tool the bare arm lacks and vice versa.
3. **Iso-budget**: identical per-task token cap, wall-clock cap, and
   retry caps across arms. Hitting a cap is a recorded failure, never an
   excluded run — unattended claims live and die on this rule.
4. **Iso-tasks**: frozen task ids per phase; tuning (prompt changes,
   hook changes) only on a held-out calibration split (first 20%),
   never on the scored split.
5. **Repeats**: k=3 for stochastic arms, same seeds across arms;
   per-instance paired analysis, not aggregate-only.
6. **Ledger**: every run's `events.jsonl`, harness logs, and usage dumps
   land in one per-run folder under the program dir; the analysis reads
   only the ledger.

## 3. Benchmarks per phase

(Verified citations, sizes, and fit arguments: `docs/research/eval-landscape.md`.
Phase 1a's step-by-step pass: `docs/plans/eval-tbench-runbook.md`.)

| Phase | Benchmark | Topology | Scale | What it settles |
|---|---|---|---|---|
| 0 | `trivia-bench` (in-repo) + existing traces | smoke | ~free | harness works; extractor correct |
| 1a | Terminal-Bench | T1 + A/B arms | full set, k=1 then k=3 on failures | H1, H3, H4 on terminal-native tasks — runbook: `docs/plans/eval-tbench-runbook.md` |
| 1b | SWE-bench Verified (random-50, seed fixed) | T1 | 50 × k arms | H1 on the coding gold standard |
| 1c | Terminal-Bench (task-class subset, ~15) | T2′ (arm E) | subset × k=3 | H7 routing + decomposition overhead on short single-terminal tasks |
| 2a | SWE-bench Verified (random-25 of the 50) | T2 (implementer + tester) | 25 × k=3 | H1/H5: does decomposition hurt |
| 2b | TheAgentCompany (subset) or MultiAgentBench metrics | T2 | subset | H5 on genuinely partitioned worlds — and the levy seat's fair fight: spurs only plausibly pay where tasks decompose |
| 3a | MLE-bench lite / RE-Bench subset | T1, overnight | small | H3 unattended at hour scale |
| 3b | distillation study | T1 rerun | 3 task types | H2: the README's whole pitch |

## 4. Attention accounting — the instrument we build

No famous benchmark scores the person's time. The trace makes it
measurable; the bare arm makes it countable by hand:

- **person-typed interventions**: commands the human typed to keep a run
  alive (resend, retry, unstick). OS arms: counted from `events.jsonl`
  (`job.continued`, `job.aborted` with a person actor, `job.fail-button`,
  any `fatal`, permission escalations a person granted). Bare arm:
  counted from terminal history + harness log, by the same rubric.
- **attention minutes**: wall-clock between a run visibly needing a
  person and that person acting. OS arms: bounded by the wake ladder;
  bare arm: unbounded (the baseline's hidden cost).
- **wake count**: OS arms ≤ 1 per levy by construction (GOAL 4);
  reported, not assumed.

## 5. The distillation curve — H2

The README's claim is precise: run the loop, read the trace, keep only
what mattered, spend "a fraction of the tokens" on the second version.
Protocol: take phase-1 runs, have one person distill the winning
exchanges into a single prompt (no tooling — manual first, per the
product story), rerun the same tasks headless, plot first-run vs
second-run tokens and success. The literature analogue (AFlow, DSPy,
TextGrad — `docs/research/papers.md` §C) automates this; we measure the
manual version the product actually promises, and note the automated
upside as future work.

## 6. Failure taxonomy — MAST, coded from the trace

Every failed unit is coded against the multi-agent failure taxonomy
(why systems fail: inter-agent misalignment, verification gaps, etc. —
exact categories in `docs/research/papers.md` §E) plus two OS-native
categories: **rail-gap** (a failure the rails should have caught) and
**harness-gap** (worker CLI failure outside OS reach). Coding is done
by one person from `events.jsonl` + transcripts, double-checked on a
20% sample. This is where eval results turn into rail tickets.

## 7. Threats to validity — stated before running

1. **Docker-on-mac variance** (arm asymmetry: containers on macOS vs
   Linux). Mitigate: all arms on the same machine; note arch; never
   compare our numbers to public leaderboards.
2. **Web drift** (GAIA-class tasks rot). Mitigate: prefer frozen
   environments (Terminal-Bench, SWE-bench) for headline numbers.
3. **Small n**. 50–100 instances gives ±7–10 pts CIs; report CIs and
   paired tests, claim nothing a CI cannot carry.
4. **Contamination**. Models have seen public benchmarks; both arms
   share the contamination, so *differences* remain meaningful; absolute
   numbers do not (never leaderboard them).
5. **Multiple comparisons**. Six hypotheses × several benchmarks;
   report per-hypothesis primary endpoints fixed in this file first.
6. **The operator is the confound** (same person wrote the OS and codes
   failures). Mitigate: the rubric is written here, before runs; MAST
   coding spot-checked by a second pass with the rubric blinded to arm.
7. **The skill is the treatment's other half.** Arm E differs from arm
   A by a prompt as much as by rails; a mid-pass skill edit silently
   re-versions the treatment. Pin the skill commit; restart the pass
   on any change. Same for arm E's levy-seat chassis (actor vs whl):
   one chassis per pass, named in the manifest.
8. **Decomposition upside is substrate-bound.** Short single-terminal
   tasks (TB2 class) give spurs little to pay with — the MAST prior
   (papers §E) says overhead likely wins. Read 1c as measuring
   ROUTING honesty, not multi-agent upside; the fair fight for spurs
   is 2b's partitionable worlds. Reporting 1c as a multi-agent verdict
   would be the wrong reading of our own data.

## 8. What would falsify the README's stance

- Fleet success significantly *below* baseline (T1) — the rails cost
  more than they manage.
- Attention numbers showing baseline arms needed no person either (H3
  vacuous) — the product solves a non-problem for these benchmarks.
- Second-run cost not materially lower (H2) — "tune from the trace" is
  poetry, not practice.
- Isolation collapsing success (H5) — privacy-by-rule buys privacy at
  unusable capability cost.
- The levy seat never choosing spurs where the task plainly decomposes,
  or always choosing them where direct wins (H7) — either way, the
  scheduler seam is decoration.

Any of these gets written down as a result, with the same prominence as
a win. That is the difference between an eval and a demo.
