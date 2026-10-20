#!/usr/bin/env bash
# accept-scout.sh — the scout stage's check (after the child's wake
# receipt): the experiment delivered its verdict artifact. Same delivery
# fold as accept-plan.sh: the booking names the child's job dir; the
# artifact lands in the parent data/ for the grade gate. The fit number
# itself is verify.sh's to judge.
set -uo pipefail
fail() { echo "scout: $1" >&2; exit 1; }
[ -s wakes/scout.json ] || fail "no wake booking for scout"
job_dir=$(jq -r .jobDir wakes/scout.json)
src="$job_dir/data/scout-verdict.json"
[ -s "$src" ] || fail "the experiment produced no data/scout-verdict.json in its child run"
jq -e '
  type == "object" and ((keys | sort) == ["fit", "probed", "rounds", "verified"]) and
  (.fit | type == "number" and . >= 0 and . <= 1) and
  (.rounds | type == "number" and floor == . and . >= 1) and
  (.probed | type == "array" and length >= 2 and
   all(.[]?; type == "string" and test("^p-[0-9]{3}$"))) and
  (.verified | type == "array" and
   all(.[]?; type == "string" and test("^p-[0-9]{3}$")))
' "$src" >/dev/null || fail "scout-verdict schema invalid"
mkdir -p data
cp "$src" data/scout-verdict.json
echo "scout: verdict accepted into data/ (fit is the grade gate's to judge)"
