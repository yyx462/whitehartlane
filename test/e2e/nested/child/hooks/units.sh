#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"child","brief":"Step 1: run exactly: echo child > /tmp/e2e-battery/out/child.txt. Step 2: write result.md in the log file's directory containing child. Then follow the log protocol below."}
BRIEF
