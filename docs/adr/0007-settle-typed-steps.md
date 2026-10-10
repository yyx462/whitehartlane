# ADR 0007: settle-typed steps — the manifest's grammar for topology

Date: 2026-10-10
Status: proposed (implementation lands in stages: parser → waves/gates → program steps)
Refs: #39 (nesting), #40 (hooks on components), ADR 0003 (detectors and gates)

## Context

A fan-out manifest is flat: units arrive from the units hook, all parallel,
and `[gates]` hold only the report. Pipelines that sequence (lazada-ozon-port:
G0 serial → PR merge → G1–G4 parallel) are hand-rolled — phase files the levy
flips, relaunches, two jobs — and the window cannot draw the chain, because
the manifest never said it. Issue #39 asks for nesting (`L{a,b} -> gate ->
FO{x,y,z}` as box-in-box); the first design attempt reused dag.ts's step
verbs (`actor|wave|grade|report|gate`) plus `program` — and review caught
them intersecting: `wave` and `report` are structure, not happenings; `gate`
mixed the checker (hook), the check, and the rail's decision.

## Decision

**One grammar, typed by settler — not by subject.** The acting nouns are a
fixed set: `worker` (agent pane), `rail` (orchestrator process), `hook`
(program-supplied command), `job` (a whole child program), `human`. Their
verbs are lifecycle-bound (spawn/settle/report/wake for the rail;
units/grade/counts/signal/end/check for hooks) and are NEVER manifest steps.
A manifest step is a node in the program's topology, typed by the signal
that settles it:

| settles on | step type | subject | example |
|---|---|---|---|
| `end` | a worker runs a brief | worker pane | `g0` porting the shared substrate |
| `check` | a command exits 0 — nothing works | hook, or a human through a file | `gh pr view … \| grep -q MERGED`; `test -f signoffs/security.md` |
| `wake` | a child job's receipt | a whole child rail | W1: the g0 fan-out as a sub-program |

```toml
[[step]]
id = "g0"
settles = "end"
wave = "w1"

[[step]]
id = "pr-merged"
settles = "check"
check = "gh pr view g0-shared --json state | grep -q MERGED"
wave = "w2"

[[step]]
id = "parallel-port"
settles = "wake"
folder = "./g1-g4"        # a complete program, runnable standalone
wave = "w3"
```

**Tie-breaker for authors:** deterministic sync check → `check`; needs
judgment → `end` (the brief says "verify and append done/blocked");
structural nesting the author declares → `wake`.

**Structure is not steps:**
- `wave` is a grouping property. A wave opens when every step of every
  earlier wave has settled. Within a wave, `end` steps run parallel under
  `slots`.
- the `report` is the epilogue after the last wave.
- the `[gates]` table is deprecated into `check` steps — one gate concept.
  two-signoffs becomes work steps plus two checks in the final wave.
- `grade` stays a lifecycle hook (fires per settled unit), never a step.

**Nesting has two legal spells, one booking rule each:**
- `settles = "wake"` — the rail levies the child job and books ITSELF as
  spawner; the step settles on the child's wake. Costs no pane; survives
  worker death.
- worker-as-levy — an `end` step whose brief says "levy this folder and
  hold"; the child books the PANE's session (ADR 0006's booked wait already
  stands the stall down). Costs a pane; the child's wake lands in the
  worker's conversation.

Both are honest; they differ in who is booked, and therefore in blast
radius. The diagram draws `wake` steps as box-in-box (click-through to the
child job); worker-as-levy stays an ordinary work node.

## Consequences

- Manifests without `[[step]]` keep today's inferred shape (units hook,
  all parallel) — the grammar is additive.
- `wake` steps arrive last: parse and validate first, then waves/checks,
  then the child-job levy. Until the executor lands, a run refuses a
  manifest containing `wake` steps with a named error — no silent lies.
- The units hook keeps its contract when steps exist (it may be the no-op
  `true`); steps define topology, the hook keeps defining provenance for
  programs that want it.
- dag.ts keeps its internal verbs (`actor|wave|grade|report|gate`) — lab
  code says in code what manifests now say in TOML.

## Renamed after adoption (2026-10-10)

One word per concept, per the dictionary rule: `settles` → `finished_by`,
settle → finish (`finishUnit`, `unit.finished` event, `finishedIds`), settled
→ finished. The two track words are untouched — the worker's `done` line,
state.json's `done`/`failed` keys, the report's `done` status. Lattice: one
umbrella word (finish), two track words (done, failed). "Settle" is retired.
