#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"never","brief":"Step 1: run exactly: sleep 3600. Do nothing else. This unit is DESIGNED to hit the run's deadline — being killed by the deadline here is the CORRECT outcome, not a failure."}
BRIEF
