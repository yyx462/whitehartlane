# verify — the last word on the dag purge

You are a worker pane for the agentic-os repo. Repo checkout (a gwt
worktree — work ONLY here):
`/Users/sagebot/projects/Agentic-Workspace/agentic-os/dag-purge-2`

Waves 1–2 (examples reorg + two-signoffs conversion; ADR 0009 + docs;
the code rename) claim to be done. You are the gate before the levy
files the PR. Fix small strays yourself; flag anything structural.

## Checks, in order

1. `npm test` — full suite, green. Paste the tail in result.md.
2. Residual sweep over the repo:
   `rg -n -i '\bdag\b|dag_id|dag\.mjs|Dag Runs'` on
   `src/ web/ bin/ plugin/ global/ jev-tuner/ test/ examples/ skills/
   structure/ CONTEXT.md docs/RAILS.md GOAL.md`.
   Allowed residuals ONLY: (a) historical records — `docs/adr/*`,
   `docs/zen/*`, `docs/research/*`, `docs/prd/*`, `GOAL.decision.md`;
   (b) explicit legacy-compat lines (the code reading old `dag.mjs` /
   `dag_id` — each such line should be recognizable as a compat spell).
   Everything else: fix it (trivial) or flag it (structural).
3. Door admission smoke on every example manifest:
   `node --experimental-strip-types -e 'import("./src/run.ts").then(m=>{for (const p of ["examples/fan-out-spurs/three-lookups","examples/fan-out-spurs/staged-waves","examples/fan-out-spurs/nested-wakes","examples/fan-out-spurs/two-signoffs","examples/coworker-spurs/steps-viz","examples/lab-spurs/lab-program"]){const r=m.prepareRun(p);console.log(p, r.ok?"admits":"REFUSED: "+r.why)}})'`
   (adapt the import path; every line must say `admits`; lab programs
   admit via their `spur.mjs`).
4. `whl jobs` answers (door alive); `agentic-os audit` clean.
5. Worktree state: everything committed except `server.log` (never
   touched by you); commit any stray you fixed, message
   `verify: residual dag sweep after ADR 0009`. If
   `agentic-program/dag-purge/project.json` exists untracked, add it
   (the OS minted it — it is bookkeeping, like three-lookups').

## Finish

Write to `result.md` in your working directory: test verdict, the
residual list (with allowed/flagged marks), admission table, anything
the levy must decide before `gwt submit-pr`.
