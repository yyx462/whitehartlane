# rename-code — implement ADR 0009 across src, web, test, examples

You are a worker pane for the agentic-os repo. Repo checkout (a gwt
worktree — work ONLY here):
`/Users/sagebot/projects/Agentic-Workspace/agentic-os/spur-word`

Mandate: `docs/adr/0009-spur-word-everywhere.md` (written in wave 1 —
read it FIRST; it is the contract) renames the dag spelling to spur.
You implement it in code. The examples were reorganized in wave 1 into
`examples/{lab-spurs,fan-out-spurs,coworker-spurs}/` — those paths exist
already; do not re-move anything.

## The sweep

1. **`src/dag.ts` → `src/spur.ts`** (git mv) with its exports:
   `loadDagFile` → `loadSpurFile`, the `Dag` graph type → your judgment
   (one word, `Spur*`), and update every importer.
2. **The run door (`src/run.ts`)**: `dagFileOf` → `spurFileOf`; resolves
   `spur.mjs` (preferred); a legacy `dag.mjs` still admits the program
   but pushes a loud warning through the existing warnings channel
   ("legacy dag.mjs — rename to spur.mjs"); BOTH present → refuse
   (`ambiguous program: both spur.mjs and dag.mjs`). `copyBeside` ships
   whichever exists. The export inside every lab program
   (`export const dag = {…}`) becomes `export const spur = {…}`, and the
   loader reads `spur` (accept legacy `dag` export with the same loud
   warning).
3. **Manifest key**: `workflow.dag_id` → `workflow.spur_id` — read both,
   `spur_id` wins; legacy-only → loud warning. Everything downstream
   (`dagIdOf` → `spurIdOf`, `registerDag` → `registerSpur`, job `dag`
   record field, `contentHashOf` callers) writes `spur_id` and reads
   both for old OS-storage records.
4. **`web/`**: `server.mjs` — `labGraph` imports `spur.mjs` and falls
   back to `dag.mjs` for old staged runs (keep the mtime cache); the
   staged-file listing pushes whichever name exists; API payloads emit
   `spur_id` and mirror `dag_id` for one transition release. `app.js` —
   every human-readable "Dag" label ("Dag Runs" etc.) → "Spur".
5. **Examples**: rename every `examples/**/dag.mjs` → `spur.mjs`,
   `export const dag` → `export const spur`, update their `workflow.toml`
   comments. Also this program itself:
   `agentic-program/dag-purge/workflow.toml` — `dag_id` → `spur_id`
   (it becomes a committed example of the new grammar).
6. **Sweep the rest**: `bin/`, `plugin/`, `global/`, `jev-tuner/`,
   `src/**` — any identifier, label, or human-facing comment still
   saying dag. Historical docs (`docs/adr/*`, `docs/zen/*`,
   `docs/research/*`, `docs/prd/*`, `GOAL.decision.md`) stay untouched.
   Legacy-compat lines you add may mention `dag.mjs`/`dag_id` — that is
   the spell reading the past.

## Tests

Update every existing test to the new names/paths, and ADD:
- legacy `dag.mjs` admits with the loud warning;
- both `spur.mjs` and `dag.mjs` → refused, named error;
- legacy `dag_id` key still resolves the spur id (with warning).

`npm test` must be fully green before you finish.

## Rules

Commit only code+tests+examples (+ the dag-purge toml line), message:
`rename: dag→spur everywhere — spur.mjs, spur_id, identifiers, labels (ADR 0009)`.
Never push; never touch `server.log`; if `.git/index.lock` is busy,
wait and retry.

## Finish

Write a summary to `result.md` in your working directory: files renamed,
the compat spells left, new tests, npm test verdict.
