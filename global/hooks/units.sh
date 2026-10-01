#!/usr/bin/env bash
# Planner: the generic units hook. Decomposes the ad-hoc task (task.txt
# in the run dir) into independent units via one headless call
# (AGENTIC_OS_PLANNER, default pi), and emits STRICT JSONL {id, brief}.
# The rail validates every line.
#
# Exit contract (backpressure, zen 3): 75 = the provider refused or
# slowed (rate limit, overload, network) — the orchestrator's rail
# retries with backoff. Any other failure is deterministic and fails
# fast; retrying it would only show the user the same doom thrice.
set -uo pipefail
task="$(cat task.txt 2>/dev/null)" || { echo "error: no task.txt in $(pwd)" >&2; exit 1; }
context="$(cat context.md 2>/dev/null || true)"

prompt="You decompose a task into independent work units.

Task: ${task}

Settled context (decisions already made — do not contradict them):
${context:-none}

Rules:
- Produce 2 to 8 units. Each unit must be doable on its own; no unit
  needs another unit's result.
- Each brief tells the worker exactly what to do, including writing its
  result to result.md in the worker's own working directory (its cwd)
  as markdown.
- Unit ids: lowercase a-z, 0-9 and hyphens only; unique; at most 24 chars.
- Output STRICT JSONL: one JSON object per line with keys id and brief.
  No prose, no code fences, no trailing commentary. Nothing else."

planner="${AGENTIC_OS_PLANNER:-pi}"
"$planner" -p "$prompt" > units-raw.txt 2>units-err.txt
rc=$?
if [ $rc -ne 0 ] || [ ! -s units-raw.txt ]; then
  err="$(head -c 300 units-err.txt 2>/dev/null | tr '\n' ' ')"
  if grep -qiE '429|rate.?limit|overload|too many requests|quota|50[023]|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|network|fetch failed' units-err.txt 2>/dev/null; then
    echo "planner refused: ${err:-rc=$rc}" >&2
    exit 75
  fi
  echo "error: planner failed (rc=$rc): ${err:-no stderr}" >&2
  exit 1
fi
grep -E '^[[:space:]]*\{' units-raw.txt || {
  echo "error: planner produced no JSON lines" >&2
  exit 1
}
