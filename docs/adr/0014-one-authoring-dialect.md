# ADR 0014 — one authoring dialect

Date: 2026-10-20 · Status: accepted — EXECUTED (slice 1 landed #176;
slice 2 — the dialect's engine — landed #183; slice 3 — the museum
conversion — landed)

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
the viewer keeps its history. The museum CONVERTED (slice 3):
`test/e2e/*`'s programs and the chain-shaped `examples/*-spurs`
programs are `[[stage]]` chains (worker briefs inline; the e2e battery
runs against them unchanged — `test/e2e/run-battery.sh`), and the
museum pieces with no honest stage spelling are gone: the bare
step-file specimen (`lab-spurs/lab-program`), the world-sourced
auto-responder (`lab-spurs/inbox-zero` — its custom signal + human
veto + requeue rode task-level detectors the delegated child cannot
carry), the units-hook example (`fan-out-spurs/three-lookups`, whose
living form is `test/fixtures/three-lookups`), and the screenshot-era
coworker shells that had no member briefs at all (`steps-viz`,
`ui-theme`, `ui-pause`, `ui-window`). Pure-exchange programs stay in
their native shape — `kind = "coworker"` with `[members.*]`, the shape
a coworker stage mints as its child; the run door's own refusal is
fan-out-only by design ("coworker carries members, a lab its actor;
neither needs stages" — `src/doors/run.ts`). `test/corpus.test.ts`
pins the corpus: every `workflow.toml` under `examples/` and
`test/e2e/` parses as a manifest, declares its workers as stages when
fan-out-shaped, and holds no retired spelling.
