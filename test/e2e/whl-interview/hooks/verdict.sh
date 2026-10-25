#!/usr/bin/env bash
# verdict.sh — the interview's pre-retire hook (#198): runs when the
# exchange sees a stop, WHILE both panes still live. Red = the rail
# hands the stop's author ONE revise round carrying this script's
# stderr verbatim (audit.py --verdict names the missing deliverable or
# the stale brief); the full transcript law stays at report time.
set -uo pipefail
exec python3 "$(dirname "$0")/audit.py" --verdict
