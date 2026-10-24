#!/usr/bin/env bash
# accept-exchange.sh — the interview stage's check (judge, after the
# child's wake receipt): the exchange ended WELL = it delivered the four
# documents. The verdict on the INTERVIEW'S CONTENT (contract schema,
# ladder stops, caps, the >=1 standing gap) belongs to the final audit
# gate — never mid-chain (#150). Delivery out of the delegated child
# rides this check: the booking (wakes/interview.json) names the child's
# job dir; its data/ and the raw mail (messages/) fold into the parent's
# data/ for the gate.
set -uo pipefail
fail() { echo "interview: $1" >&2; exit 1; }
[ -s wakes/interview.json ] || fail "no wake booking for interview"
job_dir=$(jq -r .jobDir wakes/interview.json)
[ -d "$job_dir" ] || fail "wake booking jobDir does not exist: $job_dir"
for doc in pitch topic-map explained gaps; do
  [ -s "$job_dir/data/$doc.md" ] || fail "the exchange produced no data/$doc.md in its child run"
done
[ -d "$job_dir/messages" ] || fail "child run has no messages/ folder"
mkdir -p data/messages
for doc in pitch topic-map explained gaps; do
  cp "$job_dir/data/$doc.md" "data/$doc.md"
done
cp "$job_dir/messages/"*.json data/messages/ || fail "no message files in the child run"
echo "interview: 4 documents + $(ls data/messages | wc -l | tr -d ' ') messages folded into data/ (verdict is the audit gate's)"
