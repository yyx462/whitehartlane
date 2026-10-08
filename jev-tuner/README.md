# jev-tuner

The tuning loop for every JEV-involved decision gate in this OS.

A gate is any step where production asks the `jev` CLI a typed
question. Today there are three:

| gate | kind | production call site | decides |
|---|---|---|---|
| `permission-needed` | noul | `src/permission.ts` (gray zone, via `tunedPermissionJudge`) | is this path plausibly needed for the worker's task? |
| `grill-enough` | noul | `src/grill.ts` (`jevNoul`) | is the task specified enough to run? |
| `workflow-choice` | choice | `bin/pick-workflow` (via `src/jev-prompts/`) | fan-out or direct? |

## Layout

```
jev-tuner/gates/<gate>/
  gate.json    kind (noul|choice), labels, min cases, land margin
  cases.jsonl  >= 50 test cases, LLM-seeded, one JSON per line
  prompts/     candidates: v1-baseline, v2-..., one .txt (noul) or
               .json {question, options} (choice) per candidate
  results/     one accuracy report per run
  winner.json  the landed winner: prompt, threshold, accuracy
src/jev-prompts/
  <gate>.txt   the landed prompt — production reads this live
  <gate>.json  the landed threshold (+ options for choice gates)
```

Tuner and production build the jev state string through the same
builder (`permissionJudgeState` for the permission gate), so tuning
measures exactly what the rails run.

## The loop

```sh
bin/jev-tuner list                       # gates, case counts, winners
bin/jev-tuner run permission-needed      # score all candidates (real jev)
bin/jev-tuner run permission-needed --no-land   # report only
bin/jev-tuner init <gate> --n 50         # LLM-seed more cases
bin/jev-tuner promote <gate> <candidate> # land a candidate by hand
```

`run` scores every candidate in `prompts/` against every case through
the real jev CLI (same adapter the rails use), sweeps noul thresholds
offline from the recorded probabilities, and **lands the accuracy
winner in production automatically** — it rewrites
`src/jev-prompts/<gate>.*` and records `winner.json` — when it beats
the incumbent by the gate's `margin` (default 2 points) on at least
`min_cases` cases. The rails read the landed files at call time and
fall back to compiled defaults if the files vanish, so landing is
never a deploy.

## Adding a gate

1. Put the production call through `src/jev.ts` and read its question
   from `src/jev-prompts.ts` (`loadPrompt` / `loadThreshold` /
   `loadOptions`).
2. `mkdir jev-tuner/gates/<gate>` with `gate.json`, `prompts/`, and
   `cases.jsonl` (`bin/jev-tuner init <gate>` seeds from an LLM via
   the same key jev uses — validate and append, never trust).
3. Add the gate id to `GateId` in `src/jev-prompts.ts` with a default
   prompt so the fallback always exists.
4. `bin/jev-tuner run <gate>` until a winner lands.

## Case discipline

- Gray-zone only for `permission-needed`: the deterministic paths
  (roots, secrets, outside-home) are unit-tested, not tuned — the
  judge is only asked where judgment is needed.
- Near-miss pairs (same path, wrong task) are the point: surface
  features point one way, the label the other.
- Labels are defensible from `input` alone; a case that needs outside
  knowledge is a bad case.
