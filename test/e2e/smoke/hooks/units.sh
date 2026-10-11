#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"smoke","brief":"Step 1: run exactly: mkdir -p /tmp/e2e-battery/out && echo ok > /tmp/e2e-battery/out/smoke.txt. Step 2: write a file result.md in the log file's directory containing the single word ok. Then follow the log protocol below."}
BRIEF
