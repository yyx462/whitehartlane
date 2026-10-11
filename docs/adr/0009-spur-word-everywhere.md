# ADR 0009: spur-word-everywhere — the word and the format are one

Date: 2026-10-11
Status: accepted
Refs: ADR 0007 (settle-typed steps), CONTEXT.md dictionary (Spur id)

## Context

One word per concept, per the dictionary rule. The word is `spur`; "dag"
is its previous spelling — Airflow heritage, carried out of the lab
harness this OS grew from. The dictionary already banned "DAG file" from
human reading: the word is `spur` everywhere a human reads, while
`dag`/`dag_id` stayed the historical key spelling on disk. That split
aged badly: the program file was still `dag.mjs`, the manifest key was
still `workflow.dag_id`, the code still spoke `dagFileOf`, and every new
reader had to learn two names for one thing. The levy decided to promote
the word into the format: the file, the key, and the identifiers rename
with it.

## Decision

The word AND the format are `spur`. Exact rename map (the `rename-code`
worker implements this; precision matters):

- **Lab program file**: `dag.mjs` → `spur.mjs`. The run door prefers
  `spur.mjs`, accepts a legacy `dag.mjs` with a loud warning (mirrors
  the derived-spur-id warning), and REFUSES a folder holding both —
  an ambiguous program books nothing. The JS export `export const dag`
  becomes `export const spur`.
- **Manifest key**: `workflow.dag_id` → `workflow.spur_id`. Legacy
  `dag_id` is accepted on read with a loud warning; `spur_id` wins if
  both are present.
- **OS storage/API**: new records emit `spur_id`; old records with
  `dag_id` keep reading — the window and `whl` read both. API responses
  mirror both fields for one transition release.
- **Code identifiers**: `src/dag.ts` → `src/spur.ts`; `dagFileOf` →
  `spurFileOf`; `loadDagFile` → `loadSpurFile`; `registerDag` →
  `registerSpur`; `dagIdOf` → `spurIdOf`; the lab graph type name is
  the implementer's judgment — one word, `Spur*`.
- **Human-readable labels**: "Dag Runs" and kin in the window become
  "Spur Runs".
- **Historical records stay as written**: `docs/adr/*` before 0009,
  `docs/zen/*`, `docs/research/*`, `docs/prd/*`, and
  `GOAL.decision.md` are a record of what was thought when it was
  thought — they keep the old spelling, never rewritten.

## Consequences

- Existing program folders elsewhere keep running: the legacy
  `dag.mjs`/`dag_id` read stays, with a warning — nothing breaks on
  upgrade, and nothing new is written in the old spelling.
- Old job dirs on the OS disk keep rendering: stored records with
  `dag_id` read as before.
- The `agentic-program/dag-purge/` program that executed this cleanup
  updates its own `dag_id` to `spur_id` as part of the sweep — the
  last manifest to carry the old key by intent.
- A folder holding both spellings is refused, not guessed: ambiguity
  is an authoring error, named loudly.
