#!/usr/bin/env bash
# Planner: the generic units hook. Decomposes the ad-hoc task (task.txt
# in the run dir) into independent units via one headless pi call, and
# emits STRICT JSONL {id, brief}. The rail validates every line.
set -uo pipefail
task="$(cat task.txt 2>/dev/null)" || { echo "error: no task.txt in $(pwd)" >&2; exit 1; }

prompt="You decompose a task into independent work units.

Task: ${task}

Rules:
- Produce 2 to 8 units. Each unit must be doable on its own; no unit
  needs another unit's result.
- Each brief tells the worker exactly what to do, including writing its
  result to result.md in the worker's own working directory (its cwd)
  as markdown.
- Unit ids: lowercase a-z, 0-9 and hyphens only; unique; at most 24 chars.
- Output STRICT JSONL: one JSON object per line with keys id and brief.
  No prose, no code fences, no trailing commentary. Nothing else."

pi -p "$prompt" > units-raw.txt 2>units-err.txt
rc=$?
if [ $rc -ne 0 ] || [ ! -s units-raw.txt ]; then
  echo "error: planner pi call failed (rc=$rc)" >&2
  cat units-err.txt >&2 2>/dev/null
  exit 1
fi
grep -E '^[[:space:]]*\{' units-raw.txt || {
  echo "error: planner produced no JSON lines" >&2
  exit 1
}
