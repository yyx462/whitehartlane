# ADR 0014 — one authoring dialect

Date: 2026-10-20 · Status: accepted (slice 1 landed; slice 2 pending)

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
3. Slice 2 (pending, stated in the landing PR): retire the legacy lab
   program path — `prepareLabRun`'s spur.mjs/dag.mjs admission,
   lab.ts's spur branch, spur.ts's step scheduler, and `[gates]` with
   them; the e2e battery converts to stage chains in the same slice.

Refusal beats silence: every retired spelling is answered with the fix
named, never a silent behavior change. `web/server.mjs` still renders
`[[step]]` manifests of HISTORICAL run dirs (its own parser) — the
viewer keeps its history. `examples/` and `test/e2e/` still carry
retired-spelling programs as museum pieces until slice 2.
