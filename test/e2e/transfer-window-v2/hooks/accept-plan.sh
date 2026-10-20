#!/usr/bin/env bash
# accept-plan.sh — the negotiate stage's check (judge, after the child's
# wake receipt): the exchange ended WELL = it delivered a schema-valid
# plan. The verdict on the plan's ARITHMETIC belongs to the final gate's
# verify.sh — never mid-chain (#150). Delivery OUT of a delegated child
# rides this check: the booking (wakes/<id>.json, the durable interface
# the wake machinery owns) names the child's job dir; the plan lands in
# the parent data/ and in the scout's staged folder (its next input).
set -uo pipefail
fail() { echo "negotiate: $1" >&2; exit 1; }
[ -s wakes/negotiate.json ] || fail "no wake booking for negotiate"
job_dir=$(jq -r .jobDir wakes/negotiate.json)
src="$job_dir/data/plan.json"
[ -s "$src" ] || fail "the exchange produced no data/plan.json in its child run"
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
echo "negotiate: plan accepted into data/ and stages/scout/data/ (verdict is the grade gate's)"
