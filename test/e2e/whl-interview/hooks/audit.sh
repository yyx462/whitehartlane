#!/usr/bin/env bash
# audit.sh — the gate's one-shot act (run = act): judge the interview
# transcript deterministically, then deliver. All logic lives in
# audit.py (stdlib only, testable standalone via audit-selftest.sh).
set -uo pipefail
exec python3 "$(dirname "$0")/audit.py" "${1:-.}"
