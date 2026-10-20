# ADR 0014 — one authoring dialect

Date: 2026-10-20 · Status: accepted (slice 1 landed #176; slice 2 — the
dialect's engine — landed; the museum conversion is the stated next
slice)

## Context

Three dialects authored the same concept (a program's shape) at once
(OPTIMUM §1's oscillation): the spur/dag step file, the raw `[[step]]`
tables (ADR 0007), and the units-hook quick-mint. `[[stage]]`
(#153–#158) subsumed all three; refit 5 lifted the migration gate on
evidence (the levy surface mints `[[stage]]`; the ops tree is clean).

## Decision

1. `[[step]]` tables are REFUSED at parse, pointing at `[[stage]]`
   (docs/STAGES.md). Issue #152's steps+stages mutual refusal is now
   the one-way refusal. Steps remain the compilation target of stages
   — internal, never authored.
2. `hooks.units` is REFUSED at parse: workers are declared (solo
   `brief` / fan-out `units`), never minted at runtime. A stage-less
   fan-out manifest is refused at the door before anything is booked.
   `grade` and `counts` are untouched.
3. Slice 2 — the legacy lab program path is retired whole: the run
   door refuses a `spur.mjs`/`dag.mjs` step file (named directly or
   held by the folder) with the stage fix named; lab.ts's spur branch
   is deleted — the lab engine runs only its workflow.toml shape
   (`kind = "lab"`, the shape a lab stage mints as its child, exactly
   what wake-steps.test.ts demonstrates); `src/doors/spur.ts`'s step
   scheduler is deleted with it (its consumers are gone); the
   `[gates]` detector table is refused at load — the rail-acted
   verdict is a gate stage's `run` (#150).

Refusal beats silence: every retired spelling is answered with the fix
named, never a silent behavior change. `web/server.mjs` still renders
`[[step]]`/spur manifests of HISTORICAL run dirs (its own parser) —
the viewer keeps its history. The in-tree museum — `test/e2e/*`'s
retired-spelling programs and the `examples/*-spurs` dirs — is inert
(every spelling it holds is now refused at the door or at load) and
converts to stage chains in the stated next slice.
