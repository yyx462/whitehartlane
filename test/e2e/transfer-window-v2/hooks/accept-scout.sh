#!/usr/bin/env bash
# accept-scout.sh — the scout stage's check (after the HOSTED
# experiment — ADR 0016 slice 2): the station delivered its verdict
# artifact. Same delivery fold as accept-plan.sh: the artifact promotes
# from the station's data/ shelf into the parent data/ for the grade
# gate. The fit number itself is verify.sh's to judge.
set -uo pipefail
fail() { echo "scout: $1" >&2; exit 1; }
src="stations/scout/data/scout-verdict.json"
[ -s "$src" ] || fail "the experiment produced no data/scout-verdict.json at its station"
[ -s stations/scout/report.json ] || fail "no experiment report at the station"
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
echo "scout: verdict promoted from the station into data/ (fit is the grade gate's to judge)"
