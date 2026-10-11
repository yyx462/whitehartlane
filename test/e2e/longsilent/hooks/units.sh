#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"longsilent","brief":"Step 1: run EXACTLY this single bash command and wait for it to finish (about 12 minutes — do not run anything else while it runs): for i in 1 2 3 4; do sleep 180; echo tick$i >> /tmp/e2e-battery/out/slow.txt; done. Step 2: write result.md in the log file's directory containing: survived. Then follow the log protocol below. This is a stall-detector health test: staying silent while working is CORRECT behavior — do not add any other output."}
BRIEF
