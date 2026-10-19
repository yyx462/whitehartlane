# RSI-LOOP-V2 — the redesigned redesign loop (shared understanding)

Status: agreed 2026-10-19 (grill round 1 + user answers). Implementation:
`evals/tb2/tools/loop-v2/`. Supersedes the prd-loop.sh architecture once
its first live iteration lands green (Q9). V1's record: 3/3 night PRs
merged via gate + retry + sweep (#161 #162 #163, 2026-10-19).

## The shape

```
            ┌──────────────────────── one iteration ────────────────────────┐
            │                                                                │
  refit_agent ──propose worst + cap + blast set──▶ redesign_fixer (solo)    │
  (solo, fresh      │                             runs CHEAP gates itself,  │
   context)         │                             max K rounds in-session   │
      ▲             ▼                                      │                │
      │      NEXT-TARGET.json                     FIXER-RECEIPT.json        │
      │                                                    │                │
      │                                             landing gate (rail)    │
      │                                             fences→tests→eval     │
      │                                                    │                │
      └──────── GATE-REPORT + landed PR ◀── merge+pull or refuse ◀─────────┘
```
AMENDMENT (operator, 2026-10-19): refit is NOT a third chain stage. The
chain is `fixer(solo) → landing fences(gate, fast only — the stage
`run` cap is 300s)`. The HARD gate (tests+eval+merge) runs driver-side,
and refit runs as a SECOND program after landing — refit consumes the
LANDED state (merged PR + eval verdict), never a fast-fences pass.
Dry runs skip refit (nothing landed to refit from).
The loop itself is OUTSIDE the language: a thin driver fires iteration
N+1 only under the Q6 conditions. No `loop` stage topology exists; one
is not added until ≥3 clean triggered iterations prove the body.

## Decisions (D1–D10, from grill round 1)

**D1 — constitution layering.** Invariant: the loop never edits its own
constitution. Three layers: (a) the OUTER constitution (gate fences,
global caps, briefs, this doc) — human-signed only; (b) `refit_agent`
proposals — **AMENDED 2026-10-19 per operator, in session: the
signature gate is REMOVED.** The operator's words: "they are two
different agents and I permit that" — fixer and refit being distinct
agents, the refit's NEXT-TARGET (blast set, cap, slice) takes effect
as-written and the driver chains it straight into the next fixer
(`iterate.sh --loop`). The refit's in-repo half (a docs/prd-only PR,
lane `rsi-refit:`) is absorbed by the driver: fences + fresh-clone
tests, eval SKIPPED on mechanical grounds (verified docs-only diff =
zero executable files), merge on green. (c) per-component rules for
`redesign_fixer` (whitelist = blast set, per-component cap) — authored
by refit, bounded by the outer ceiling. refit is isolated from the
fixer; refit never authors the fixer's constitution, only its
per-target parameters.

**D2 — the worst is a number, not a vibe.** `momentum.py` computes per
component: fix-density (merged PRs touching it), oscillation (reversal
pairs — PR sequences that re-add what a prior PR removed, or
revert/fix-of-fix titles), churn (Σ add+del), and runtime loss (eval
deltas; column reserved — populated only where FINAL-VERDICT history
exists, never faked). The pick must sit at the top of its own table;
OPTIMUM.md carries the table with receipts.

**D3 — the dead-loop cure (exact).** A *strike* = one gate-red round
whose GATE-REPORT cites a cause-class (`cap`, `scope`, `tests`,
`evidence`, `eval`). Three strikes on the SAME cause-class for one
component in one iteration:
  1. the fixer stops — it never sees a 4th rejection on that cause;
  2. `ESCALATED.<component>` is written to state; the PR is left open,
     labeled `straggler`;
  3. the loop MOVES ON (next iteration = fresh refit);
  4. the NEXT refit reads the strike record and re-proposes exactly one
     of: LARGER CAP (justified), DECOMPOSITION (slices), or DOWNGRADE
     (component → WATCH, note in OPTIMUM.md).
The fixer never grinds against a cap; the CAP is refit's to redesign.
"Minimal" = scope (every file ∈ the declared blast set), never size —
size is a coarse backstop only, because a replacement is a big diff by
nature.
Worked example: `runner-dispatch` declared cap 900, blast
`{src/orchestrator*, bin/orch*, build.mjs}`. PR-1 diff 1240 →
`fail: cap (1240>900) strike 1/3`. Retry 1105 → strike 2/3. Retry 1088
→ strike 3/3 → ESCALATED, loop continues elsewhere; next refit proposes
`runner-dispatch/slice-a cap 600 (orchestrator.ts only)` +
`slice-b (bins)`, or cap 1500 with justification.

**D4 — the monitor is outside the rail; the relay speaks GATE-REPORT.**
The *monitor* is not a whl actor at all: it is the blocking script
(`monitor.sh`) the daytime agent runs — it watches state files, never
talks to the fixer, pages on terminal states. INSIDE the loop, gate
verdicts reach the fixer two ways: (a) in-session — the fixer runs the
cheap gates itself and parses their JSON directly; (b) landing bounce —
the driver injects one well-formed message (the relay preamble) back
into the fixer's context. Both use ONE format, tri-state:

```json
{ "verdict": "pass | fail | gate-error",
  "gate": "fences | tests | eval",
  "trace": [ {"check": "scope", "pass": false,
              "detail": "src/front-door.ts outside blast set",
              "files": ["src/front-door.ts"]}, ... ],
  "cause": "scope",
  "strike": "2/3",
  "budget_left": 1 }
```
`gate-error` (eval hung, clone failed, gh down) trips the monitor,
NEVER the fixer — boolean verdicts are banned because they erase
exactly this case.

**D5 — spur design.** One [[stage]] program per iteration, from a
checked-in template (`program.template.toml`) — agents fill brief and
target fields, never topology:
  - stage 1 `redesign-fixer` (solo): brief = target JSON + blast set +
    cap + this contract: run `gate-report.sh --cheap` in your worktree
    yourself, max K=4 rounds, fix on `fail` (read the trace), STOP and
    report on `gate-error`, on pass push branch + open `rsi-redesign:`
    PR + write `FIXER-RECEIPT.json {pr, rounds, strikes_used}`.
  - stage 2 `landing` (gate topology — the rail itself, verify.sh
    lives here): runs `landing-gate` = fences (scope+cap+evidence) →
    tests (fresh clone of PR head) → `topo-tune` (real levy, joint
    N/W target) — ONCE, not per inner round. Emits GATE-REPORT.json.
    One eval-red bounce to the fixer maximum, then ESCALATED.
  - stage 3 `refit` (solo, fresh context): momentum metrics from PR
    history → OPTIMUM.md update (regenerated, never appended) +
    NEXT-TARGET.json {component, blast_set, cap, rationale} + strikes
    accounting. Parameter changes are INERT until human sign (D1).
The HARD quality gate is stage 2 — scripts only, zero agent judgment.

**D6 — cadence: triggered ×3, then loop.** **SUPERSEDED 2026-10-19 per
operator: chaining is permitted immediately** — `iterate.sh --loop`
runs iterations back-to-back in one commissioning (the amendment to D1
removed the per-iteration stop). The chain continues ONLY on clean full
landings (fixer → gate → merge → refit → absorb); every terminal state
— DEAD, GATE-INFRA, refused-twice, BUDGET-OUT (MAX 6 per
commissioning), refit failure, red absorb — still stops the loop for
the human. Each refit is a fresh context; the only memory is OPTIMUM.md
+ the strike ledger (that is why they must carry everything).

**D7 — pin and master.** The loop runs whl from a worktree PINNED at
loop start (`state/pin` = {path, commit}); master stays the
proven-working rail. If a whl invocation itself fails (spawner/infra
error, not a component PR failing): attempt to REPAIR THE PIN for up to
3 iterations (the loop dogfoods — the broken component will naturally
top the momentum table); still failing after 3 → fall back to master
pin, ESCALATION note, continue. The pin advances only at the next loop
start; mock rehearsal on live master at landing catches rail-breaking
merges before the pin ever advances onto them.

**D8 — monitor contract + telemetry.** Blocking; exits only on:
`0` DONE-clean · `2` DEAD (driver exited nonzero / heartbeat stale
>20min while pid alive — the 01:33 lesson) · `3` ESCALATED ·
`4` BUDGET-OUT (iterations ≥ MAX 6, or wall-clock deadline) ·
`5` GATE-INFRA. On exit: last 40 log lines + ledger tail + open PRs +
strike table + Telegram ping. Telemetry: every phase stamps
start/end into `telemetry.json`; `--watch` mode warns early when a
phase exceeds 1.5× the running median (tune + track, per the
operator's ask). The monitor never kills anything — no watchdog.

**D9 — cutover.** Iteration #0 = dry (full pipeline, landing verdicts
computed, NO merge — `iterate.sh --dry`). V1 (prd-loop + sweep)
retires only after V2's first live green iteration. The queue dies
with V1: OPTIMUM.md + strikes become the only memory.

**D10 — placement.** Template, driver, monitor, gates, briefs live in
`evals/tb2/tools/loop-v2/` (ops side — same separation as the check-in
app); the rail repo stays the product. The loop's whl comes from the
pin worktree.

## Invariants

1. The loop never edits its own constitution (D1).
2. Never land eval-red work; never eval unmerged work (landing order:
   fences → tests → eval → merge).
3. An iteration never starts while an rsi* PR is open (landing absorbs
   the sweep's job).
4. Every gate verdict is tri-state; gate-error reaches the monitor,
   never the fixer (D4).
5. No component gets more than 3 same-cause strikes in one iteration
   (D3).
6. Refit parameter changes take effect as-written (D1, amended
   2026-10-19); a red refit-PR absorb or any terminal state stops the
   loop for the human.
7. The loop's whl runs only from the pin (D7).
