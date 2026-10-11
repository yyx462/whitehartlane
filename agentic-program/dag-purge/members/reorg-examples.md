# reorg-examples — reorganize examples/ by rail kind

You are a worker pane for the agentic-os repo (a supervisor OS for agent
work). Repo checkout (a gwt worktree — work ONLY here):
`/Users/sagebot/projects/Agentic-Workspace/agentic-os/dag-purge-2`

Mandate: the examples are a mess of vintages. Reorganize into three
folders by rail kind, convert one stale example to the current grammar,
and fix every path reference. **Moves and the conversion ONLY — do NOT
rename any `dag.mjs` file and do NOT touch src/ or web/ identifiers; the
`rename-code` worker owns that sweep in the next wave.**

## Target layout (locked — other members rely on these exact paths)

- `examples/lab-spurs/` ← move `examples/lab-program`, `examples/git-wave`,
  `examples/agentic-program/inbox-zero`, `examples/agentic-program/trivia-bench`
- `examples/fan-out-spurs/` ← move `examples/three-lookups`,
  `examples/staged-waves`, `examples/nested-wakes`, and
  `examples/agentic-program/two-signoffs` (converted, see below)
- `examples/coworker-spurs/` ← move `examples/agentic-program/pause-fixture`,
  `examples/agentic-program/steps-viz`, `examples/agentic-program/ui-pause`,
  `examples/agentic-program/ui-theme`, `examples/agentic-program/ui-window`
- `examples/agentic-program/` must cease to exist (empty → removed).

Use `git mv` so history follows. Keep each example's `project.json`
(don't edit its pid), `data/`, `hooks/`, `members/` as they are.

## Convert two-signoffs (ADR 0007's own named example)

Read `docs/adr/0007-settle-typed-steps.md` first. Today two-signoffs is
a lab program (`dag.mjs` + deprecated `[gates]`). Rewrite it as a
manifest program with `[[step]]` check steps, living in
`examples/fan-out-spurs/two-signoffs/`:

- Delete its `dag.mjs` and the `[gates]` table.
- `workflow.toml`: keep `[workflow] name/worker_kind`, `[hooks]`
  (units `true`, grade `true`, counts as-is), `[report] where = "units/"`.
- Steps: wave w1 = `id = "draft"`, `finished_by = "end"` (a worker pane
  runs `members/draft.md` — write that brief from the old `actor.md`
  content: produce the deliverable into `data/signoffs/` target area
  exactly as the actor brief intended); wave w2 = `id = "signoff-legal"`,
  `finished_by = "check"`, `check = "test -f signoffs/legal.md"` and
  `id = "signoff-security"`, `finished_by = "check"`,
  `check = "test -f signoffs/security.md"`. Drop the now-unused
  `hooks/legal.mjs`/`hooks/security.mjs` if nothing else references them.
- The result must pass the door: `node --experimental-strip-types -e
  'import("./src/run.ts").then(m=>{const r=m.prepareRun("examples/fan-out-spurs/two-signoffs");console.log(r.ok? "admits":"refused: "+r.why)})'`
  (adjust the import path if needed; it must print `admits`).

## Fix path references (yours)

After the moves, `rg -l 'examples/(agentic-program|lab-program|git-wave|three-lookups|staged-waves|nested-wakes)'`
over `test/`, `src/`, `bin/`, `web/`, `docs/RAILS.md` — update every hit
to the new path. Living docs only; do NOT edit `docs/adr/*`,
`docs/zen/*`, `docs/research/*`, `docs/prd/*`, `GOAL.decision.md`
(history stays as written) and do NOT edit `skills/yyx-whl/SKILL.md`
(the `adr-dictionary` worker owns it). Then run `npm test` — the suite
must pass before you finish.

## Rules

- Commit only the paths you own (examples/, the reference fixes): 
  `git -C /Users/sagebot/projects/Agentic-Workspace/agentic-os/dag-purge-2 add <paths>`
  then commit, message: `reorg: examples into {lab,fan-out,coworker}-spurs; two-signoffs to check steps`.
  Never push. If `.git/index.lock` is busy, wait and retry.
- Never touch `server.log`, `agentic-program/dag-purge/` (this program),
  or anything under `src/` beyond the path-reference fixes above.
- A stray `project.json` appearing inside `dag-purge/` is the OS's —
  leave it.

## Finish

Write a summary to `result.md` in your working directory: what moved
where, the two-signoffs shape, the references fixed, test verdict.
