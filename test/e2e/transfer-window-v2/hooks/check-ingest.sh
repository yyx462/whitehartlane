#!/usr/bin/env bash
# check-ingest.sh — the ingest stage's verdict (check = judge): the
# normalized universe is schema-exact and complete. Runs from the run
# dir (the rail's cwd for stage hooks).
set -uo pipefail
fail() { echo "ingest: $1" >&2; exit 1; }
[ -s data/players.jsonl ] || fail "data/players.jsonl missing"
[ -s data/players.csv ] || fail "data/players.csv missing"
csv_rows=$(( $(wc -l < data/players.csv) - 1 ))
# schema: exact keys, integer money/ages, id pattern, known groups
jq -se --argjson want "$csv_rows" '
  length == $want and
  (map(.id) | unique | length) == length and
  all(type == "object"
      and ((keys | sort) == ["age","contract_years","fee_gbp_k","form_pct",
                             "id","name","pos_group","position","wage_gbp_k"])
      and (.id | test("^p-[0-9]{3}$"))
      and (.name | type == "string" and length > 2
           and ((startswith(" ") or endswith(" ") or test("  ")) | not))
      and (.pos_group == "gk" or .pos_group == "def" or .pos_group == "mid" or .pos_group == "fwd")
      and (.position | type == "string")
      and all(.age, .fee_gbp_k, .wage_gbp_k, .form_pct, .contract_years;
              type == "number" and floor == .))
' data/players.jsonl >/dev/null || fail "schema/rows: $(wc -l < data/players.jsonl) jsonl lines vs $csv_rows csv rows, or a line fails the schema"
echo "ingest: $csv_rows players, schema exact"
