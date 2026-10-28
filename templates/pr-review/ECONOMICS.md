# ECONOMICS — what a review costs, measured on the rail's own 8 rounds

Data: the self-review recursion of PR #250 (13 runs: 8 verdicts + 2
dead rounds + 1 killed + re-runs), traced by
`node scripts/review-trace.mjs` from the job dirs + the opencode DB.
Every number below is a measurement, not an estimate.

## The rounds

| round | wall | verdict | blocked | input | output | cache-read |
|-------|------|---------|---------|-------|--------|-----------|
| r1    | 23.1m | reject  | 7 | 596k | 55k | 12.5M |
| r2    | 26.1m | reject  | 5 | 549k | 55k | 13.9M |
| r3    | 32.7m | reject  | 3 | 572k | 58k | 15.1M |
| r4    | 31.6m | reject  | 3 | 560k | 50k | 13.1M |
| r5†   | 10.9m | killed  | – | **1260k** | 58k | 17.3M |
| r5    | 29.9m | reject  | 5 | 625k | 55k | 15.4M |
| r6†   | 27.3m | stalled | – | 590k | 41k | 12.0M |
| r6b   | 32.4m | reject  | 4 | 596k | 53k | 18.0M |
| r7    | 28.5m | reject  | 2 | 594k | 48k | 18.6M |
| r8†   | 31.9m | dead pane | – | 525k | 39k | 13.0M |
| r8b   | 33.8m | reject  | 3 | 597k | 53k | 17.8M |
| **Σ** | **5.1h** | 8 rejects | 32 | **7.06M** | 565k | 166.7M |

† = burned rounds: no verdict for the spend. Killed r5 alone cost 2.2×
a healthy round; the r6→r6b and r8→r8b full re-runs re-burned ~450k
each on three already-green lenses. **Waste ≈ 2.2M input ≈ 31% of all
spend.**

Per lens (healthy rounds): principles 129–190k, tests 126–177k,
momentum 101–153k, questions 101–161k input; divide is noise (23–38k).
The four lenses are ~92% of a round's cost.

## Duplicates — the measured recursion bottleneck

15 (file:invariant) keys were re-litigated in ≥2 rounds; the worst:

```
coworker-run.ts:INV-3   ×5 rounds     hooks.ts:INV-3          ×5
prove.sh:INV-8          ×4            opencode-host.ts:INV-2  ×4
hooks.ts:INV-2          ×4            orchestrator.ts:INV-3   ×3
```

Each re-litigation costs a full lens context (~130k input): round N's
lenses re-derive rounds 1..N-1's ground from zero, because nothing
carries forward. The findings were REAL (each round caught the prior
fix's unfinished twin) — but the exploration that found them was
re-bought every round.

## Proposals (each with its receipt)

### 1. Reduce duplicates

- **Delta rounds** — after r1, review `prior-reviewed-head..head`
  (the fix commits), not the whole base..head again. The full-diff
  habit is the single biggest multiplier: 8 × ~590k ≈ 4.7M input
  where ~590k + 7×~200k ≈ 2.0M would do (−57%). The lens brief gains
  a "prior verdict + fixed-in <sha>" pack so twins are VERIFIED, not
  re-discovered.
- **Handoff artifacts on the program dir** — materialize
  `data/review/handoff.md` (prior verdict.json + advisory.md + fix
  shas) when a prior review job exists; lens briefs quote it. Kills
  the 15-key class at the source.
- **Prove-stage dedup by (file, invariant)** — r6b's 4 blocked
  findings were 2 root decisions wearing 4 site labels; the gate
  should collapse same-key findings before divide, halving feedback
  and the refine rounds that follow.

### 2. Save tokens

- **Re-levy, never re-materialize** (already the skill's hard rule) —
  the r6/r8 receipts: ~0.9M input re-burned on green lenses. The
  spell is `whl run <same program dir> --unattended`; if the door
  refuses because the killed run's Job still reads running (a SIGKILL
  leaves it that way), `whl sweep` orphans the dead run first — the
  booking probe (r16) records the orphan and the re-levy books past
  it, the re-levy fold (r16) sparing the done units.
- **Kill the killed-round class** — r5's 1.26M died mid-exploration
  because a manual kill landed after the lenses were deep in. An
  abort should checkpoint unit state so a re-levy resumes, not
  restarts, the lens.
- **Questions lens demotion** — 101–161k/round for 2–5 findings that
  routinely twin principles' (same files in both lists). Fold its
  QUESTIONS.md checklist into the principles brief: −1 lens ≈ −130k
  (−22%)/round. Revisit only if drill cases regress.
- **Byte-stable retry briefs** — 12–18M cache-read/round shows the
  provider cache carrying the real weight; a re-prompted lens must
  get the byte-identical brief (today reprompt re-submits it — keep
  it that way, it is load-bearing).
- **Usage telemetry in the rail** — this table required DB
  archaeology (`scripts/review-trace.mjs`); the rail should record
  per-unit token aggregates in `units.jsonl`/`table.json` so
  `whl jobs` shows economics natively.

### 3. Faster

- **Born-check fast-fail** — 2–3 min after spawn, assert a session
  exists for the unit; no session → respawn immediately. r8's
  dead-at-birth pane burned 31.9 min of ceiling; with a born-check it
  dies in ~3. This also resolves the r6↔r8 tension: stall_ms can stay
  generous (30 min, r6's receipt) once never-started is caught by the
  born-check instead of the silence ladder.
- **Heartbeat protocol** — lenses append one line per artifact to
  `log.txt` (finding written, coverage started). With movement
  visible, the stall ceiling drops back toward 10 min without r6's
  false kill; a real hang dies 3× faster.
- **Divide needs nothing** — 23–38k input, minutes of wall; leave it.
- **settle_mode = status-first** (experiment) — marker-wait tails add
  idle minutes per stage; measure before adopting.
- Wall is lens-bound: mean 28.4 min/round, and the slowest lens gates
  the chain. Every token cut above is also a wall cut.
