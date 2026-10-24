#!/usr/bin/env bash
# audit.sh — the counts hook, i.e. the interview's audit gate: judge the
# transcript deterministically at report time, deliver on PASS. The rail
# absolutizes this command against the source and runs it with cwd = the
# run dir; all logic lives in audit.py (stdlib only, testable standalone
# via audit-selftest.sh). WHL_AUDIT_DIR overrides the run dir for tests.
set -uo pipefail
exec python3 "$(dirname "$0")/audit.py" "${WHL_AUDIT_DIR:-$PWD}"
