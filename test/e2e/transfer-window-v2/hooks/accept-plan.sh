#!/usr/bin/env bash
# accept-plan.sh — the negotiate stage's check (judge, after the HOSTED
# exchange — ADR 0016 slice 1): the exchange ended WELL = it delivered
# a schema-valid plan at its station. The verdict on the plan's
# ARITHMETIC belongs to the final gate's verify.sh — never mid-chain
# (#150). Delivery OUT of a station rides this check: the plan promotes
# from the station's data/ shelf to the parent data/ and the scout's
# staged folder (its next input) — data/ promotion is the placement
# law's promotion step.
set -uo pipefail
fail() { echo "negotiate: $1" >&2; exit 1; }
src="stations/negotiate/data/plan.json"
[ -s "$src" ] || fail "the exchange produced no data/plan.json at its station"
[ -s stations/negotiate/relay.json ] || fail "no exchange record at the station"
jq -e '
  type == "object" and ((keys | sort) == ["budget_gbp_k", "spent_gbp_k", "squad"]) and
  (.budget_gbp_k | type == "number" and floor == .) and
  (.spent_gbp_k | type == "number" and floor == .) and
  (.squad | type == "array" and length >= 9 and length <= 13) and
  all(.squad[];
      type == "object" and
      ((keys | sort) == ["fee_gbp_k", "id", "name", "pos_group"]) and
      (.id | test("^p-[0-9]{3}$")) and
      (.pos_group == "gk" or .pos_group == "def" or .pos_group == "mid" or .pos_group == "fwd") and
      (.fee_gbp_k | type == "number" and floor == .))
' "$src" >/dev/null || fail "plan schema invalid"
mkdir -p data stages/scout/data
cp "$src" data/plan.json
cp "$src" stages/scout/data/plan.json
echo "negotiate: plan promoted from the station into data/ and stages/scout/data/ (verdict is the grade gate's)"
