# adr-dictionary — write ADR 0009, teach the word everywhere it lives

You are a worker pane for the agentic-os repo. Repo checkout (a gwt
worktree — work ONLY here):
`/Users/sagebot/projects/Agentic-Workspace/agentic-os/dag-purge-2`

Mandate: the dictionary (root `CONTEXT.md`, entry **Spur id**) already
says "The word is `spur` everywhere a human reads; `dag`/`dag_id` remain
the historical key spelling … a format, never the word." The levy has
decided to promote the word into the format. Write the ADR, update the
dictionary and every living surface that teaches the old spelling.
**You own docs + skills + structure ONLY — do NOT touch `src/`, `web/`,
`test/`, `bin/`, or `examples/`** (parallel and later workers own those).

## 1. Write `docs/adr/0009-spur-word-everywhere.md`

Status: accepted. Refs ADR 0007, CONTEXT.md dictionary. Context: one
word per concept; "dag" is the previous spelling of spur (Airflow
heritage); the dictionary already banned "DAG file" from human reading;
the file name and the TOML key still said dag. Decision (this exact
map — the `rename-code` worker implements it, so it must be precise):

- Lab program file: `dag.mjs` → `spur.mjs`. The run door prefers
  `spur.mjs`, accepts a legacy `dag.mjs` with a loud warning (mirrors
  the derived-spur-id warning), and REFUSES a folder holding both
  (ambiguous program). The JS export `export const dag` becomes
  `export const spur`.
- Manifest key: `workflow.dag_id` → `workflow.spur_id` (legacy `dag_id`
  accepted on read with a loud warning; `spur_id` wins if both).
- OS storage/API: new records emit `spur_id`; old records with `dag_id`
  keep reading (the window and `whl` read both). API responses mirror
  both fields for one transition release.
- Code identifiers: `src/dag.ts` → `src/spur.ts`; `dagFileOf` →
  `spurFileOf`; `loadDagFile` → `loadSpurFile`; `registerDag` →
  `registerSpur`; `dagIdOf` → `spurIdOf`; the lab graph type name is the
  implementer's judgment (one word, `Spur*`).
- Human-readable labels ("Dag Runs" etc. in the window) → "Spur Runs".
- Historical records (`docs/adr/*` before 0009, `docs/zen/*`,
  `docs/research/*`, `docs/prd/*`, `GOAL.decision.md`) stay as written.

Consequences: existing program folders elsewhere keep running (legacy
read, warning); old job dirs on the OS disk keep rendering; the
`agentic-program/dag-purge/` program that executed this cleanup updates
its own `dag_id` to `spur_id` as part of the sweep.

## 2. Update root `CONTEXT.md`

- **Spur id** entry: replace the "historical key spelling" sentence —
  the word AND the format are `spur` (`spur.mjs`, `spur_id`); legacy
  `dag`/`dag_id` remain readable on disk and in old manifests, a format
  of the past, never written new.
- Sweep every entry for stray `dag` usage; keep the football-metaphor
  line intact.

## 3. Update `docs/RAILS.md`

The `gates` bullet (~line 133) teaches `does: "gate"` steps in
`dag.mjs`. Rewrite for the current world: lab programs are `spur.mjs`
(legacy `dag.mjs` read with warning); `[gates]` is the legacy lab spell,
`[[step]]` `check` steps are the current grammar (ADR 0007).

## 4. Rewrite Gate 2 of `skills/yyx-whl/SKILL.md`

Today Gate 2 teaches only `[workflow]`/`[hooks]`/members and points at
`examples/agentic-program/` (stale, mixed vintages). Rewrite it to
teach the manifest properly:

- A minimal inline template: `[workflow] name/dag_id→(note: `spur_id`
  after ADR 0009)/kind/slots`, `[hooks] units/grade/counts`, and
  `[[step]]` with `id`, `finished_by = "end" | "check" | "wake"`,
  `check =`, `folder =`, `wave =`.
- The author's tie-breaker from ADR 0007: deterministic sync check →
  `check`; needs judgment → `end` (the brief says "verify and append
  done/blocked"); a declared child program → `wake`.
- Waves are grouping properties — a wave opens when every earlier wave
  finished; `end` steps within a wave run parallel under `slots`.
- No `dag.mjs`/`spur.mjs` in a fan-out/coworker spur folder — a program
  file present makes it a LAB spur (different rail).
- Point at the reorganized examples (locked paths, being created in
  parallel): `examples/fan-out-spurs/staged-waves` (waves + a check),
  `examples/fan-out-spurs/nested-wakes` (wake steps), 
  `examples/coworker-spurs/steps-viz` (coworker), 
  `examples/lab-spurs/lab-program` (lab rail), and ADR 0007 + 0009.

## 5. `structure/`

`structure/agentic-os-dag/` → `structure/agentic-os-spur/` (git mv);
update the cast lines that teach `dag.mjs` as the program shape (rows
mentioning `dag.mjs`, "run door stages dag.mjs") to `spur.mjs`. Minimal
line edits — no redraw, no new cast.

## Rules

Commit only your paths, message:
`docs: ADR 0009 spur-word-everywhere; dictionary, RAILS, skill, cast teach spur`.
Never push; never touch `server.log`, `src/`, `web/`, `test/`,
`examples/`, `agentic-program/dag-purge/` (beyond leaving it alone).

## Finish

Write a summary to `result.md` in your working directory: the ADR path,
each surface updated, any word you left as history and why.
