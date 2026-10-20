#!/usr/bin/env bash
# verify.sh — the composite case's task verifier: CHECKS, never vibes
# (the grade gate; fires ONCE at the end of the chain, #150). Judges
# the plan against the commission (data/window.json), the universe
# (data/players.jsonl), and the scout's probes (data/scout-verdict.json).
set -uo pipefail
fail() { echo "FAIL $1"; exit 1; }
for f in data/window.json data/players.jsonl data/plan.json data/scout-verdict.json; do
  [ -s "$f" ] || fail "$f missing"
done
budget=$(jq -r .budget_gbp_k data/window.json)
mins=$(jq -c .min data/window.json)

# 1. output schema — the plan's shape is exact
jq -e '
  type == "object" and ((keys | sort) == ["budget_gbp_k", "spent_gbp_k", "squad"]) and
  (.squad | type == "array" and length >= 9 and length <= 13) and
  all(.squad[];
      ((keys | sort) == ["fee_gbp_k", "id", "name", "pos_group"]) and
      (.id | test("^p-[0-9]{3}$")) and (.name | type == "string") and
      (.pos_group == "gk" or .pos_group == "def" or .pos_group == "mid" or .pos_group == "fwd") and
      (.fee_gbp_k | type == "number" and floor == .))
' data/plan.json >/dev/null || fail "output schema: plan.json is not the declared shape"

# 2. budget arithmetic EXACT — spent equals the sum of squad fees, and
#    the declared budget is the window's
sum=$(jq '[.squad[].fee_gbp_k] | add' data/plan.json)
spent=$(jq -r .spent_gbp_k data/plan.json)
[ "$sum" = "$spent" ] || fail "budget arithmetic: spent_gbp_k $spent != sum of squad fees $sum"
[ "$(jq -r .budget_gbp_k data/plan.json)" = "$budget" ] || fail "budget arithmetic: plan budget != window budget $budget"
[ "$spent" -le "$budget" ] || fail "budget arithmetic: spent $spent over the cap $budget"

# 3. coverage complete — every group meets its window minimum
jq -e --argjson min "$mins" '
  (reduce .squad[].pos_group as $g ({}; .[$g] = ((.[$g] // 0) + 1))) as $c |
  $min | to_entries | all(.key as $k | $c[$k] // 0 >= .value)
' data/plan.json >/dev/null || fail "coverage: $(jq -c --argjson m "$mins" 'reduce .squad[].pos_group as $g ($m; .[$g] = (.[ $g] - 1)) | to_entries | map(select(.value > 0) | .key) | join(",")' data/plan.json) under minimum"

# 4. no duplicate players
[ "$(jq '[.squad[].id] | unique | length' data/plan.json)" = "$(jq '.squad | length' data/plan.json)" ] \
  || fail "duplicate players: a squad id appears twice"

# 5. the squad is the universe's — every id known, every fee EXACTLY as
#    listed (no invented players, no doctored fees)
jq -s -e --slurpfile plan data/plan.json '
  (map({key: .id, value: .fee_gbp_k}) | from_entries) as $u |
  $plan[0].squad | all(.[]; $u[.id] != null and $u[.id] == .fee_gbp_k)
' data/players.jsonl >/dev/null || fail "universe: a squad id is unknown or its fee_gbp_k disagrees with players.jsonl"

# 6. the probes earned it — every squad id is probe-verified
jq -e -s --slurpfile plan data/plan.json --argjson thr "$(jq -r .fit_threshold data/window.json)" '
  .[0] as $v | ($plan[0].squad | map(.id)) as $ids |
  (($v.verified // []) as $ver |
   ($ids | all(. as $i | $ver | index($i) != null)))
' data/scout-verdict.json >/dev/null || fail "scout: not every squad id is probe-verified (fit below threshold)"

n=$(jq '.squad | length' data/plan.json)
echo "PASS squad=$n spent=$spent/$budget, coverage/fees/probes exact"
