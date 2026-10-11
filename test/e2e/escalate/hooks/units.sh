#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"escalate","brief":"Permission dialogs WILL pop up — do NOT answer or cancel them yourself; an external watcher answers within seconds. Step 1: attempt to create the file /Users/sagebot/e2e-weird-scratch/marker.txt with content x. Step 2: if that attempt was DENIED, attempt the exact same write exactly ONCE more. Step 3: write result.md in the log file's directory with: attempt1: <allowed|denied> and attempt2: <allowed|denied|not-tried>. Then follow the log protocol below."}
BRIEF
