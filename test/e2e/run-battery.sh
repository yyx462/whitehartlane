#!/usr/bin/env bash
# run-battery.sh — fire the e2e scenarios sequentially and print the receipt
# lines a babysitting levy grades against. Usage:
#   test/e2e/run-battery.sh <repo-checkout> opencode:<session-id>
set -uo pipefail
repo="${1:?usage: run-battery.sh <repo-checkout> opencode:<sid>}"
from="${2:?usage: run-battery.sh <repo-checkout> opencode:<sid>}"
here="$(cd "$(dirname "$0")" && pwd)"

# fixtures
mkdir -p "$HOME/e2e-shots" && printf 'fakepng-bytes' > "$HOME/e2e-shots/shot.png"
mkdir -p "$HOME/e2e-vault" && printf 'FAKE_TOKEN=not-a-real-secret\n' > "$HOME/e2e-vault/.env"
mkdir -p /tmp/e2e-battery/out

for s in smoke waves shots secrets escalate longsilent nested deadline; do
  echo "== $s =="
  (cd "$here/$s" && "$repo/bin/whl" run . --from "$from" 2>&1 | grep -E '^job:|warning')
  # sequential: wait for each to finish before the next (see README, #78)
  while :; do
    running=$("$repo/bin/whl" jobs 2>/dev/null | awk -v s="$s" '$0 ~ s && $2 == "running"')
    [ -z "$running" ] && break
    sleep 20
  done
done
echo "battery done — grade each run's report.json, orchestrator.log (permission/stall lines), and job.json woke.delivery (expect pane, your pane)"
