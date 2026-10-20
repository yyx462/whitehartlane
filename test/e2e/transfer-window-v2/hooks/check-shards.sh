#!/usr/bin/env bash
# check-shards.sh — the analyze stage's verdict. A fan-out stage's check
# runs per finishing unit with no unit id, so it validates every shard
# that EXISTS: the finisher's own is present by construction (it just
# wrote it), the last finisher re-validates all three.
set -uo pipefail
fail() { echo "analyze: $1" >&2; exit 1; }
shopt -s nullglob
shards=(stages/negotiate/data/shortlist-*.json)
[ ${#shards[@]} -gt 0 ] || fail "no shortlist-*.json in stages/negotiate/data/"
for f in "${shards[@]}"; do
  base=$(basename "$f" .json)
  case "$base" in
    shortlist-defensive) allowed='["gk","def"]' ;;
    shortlist-midfield)  allowed='["mid"]' ;;
    shortlist-forward)   allowed='["fwd"]' ;;
    *) fail "$base: not one of the three declared shards" ;;
  esac
  jq -e --argjson allowed "$allowed" '
    type == "object" and ((keys | sort) == ["group", "targets"]) and
    (.group | type == "string") and
    (.targets | type == "array" and length >= 2 and length <= 8) and
    all(.targets[];
        type == "object" and
        ((keys | sort) == ["fee_gbp_k", "id", "name", "pos_group", "reason"]) and
        (.id | test("^p-[0-9]{3}$")) and
        (.fee_gbp_k | type == "number" and floor == .) and
        (.pos_group as $g | $allowed | index($g) != null) and
        (.reason | type == "string" and length > 3))
  ' "$f" >/dev/null || fail "$f: shard schema invalid (targets must sit in the shard's own group)"
done
echo "analyze: ${#shards[@]} shard(s), schemas exact"
