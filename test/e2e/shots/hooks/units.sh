#!/usr/bin/env bash
set -euo pipefail
cat <<'BRIEF'
{"id":"shots","brief":"You will read a file OUTSIDE every root of this run. Permission dialogs will pop up — do NOT answer or cancel them yourself; an external watcher answers within seconds. Step 1: read the file /Users/sagebot/e2e-shots/shot.png (cat it). Step 2: read the SAME file a second time (cat it again). Step 3: write result.md in the log file's directory with two lines: first-read: <succeeded|denied> and second-read: <succeeded|denied> and a third line dialogs-seen: <count of dialogs you saw pop up, your best count>. Then follow the log protocol below."}
BRIEF
