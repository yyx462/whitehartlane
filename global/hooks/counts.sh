#!/usr/bin/env bash
# Generic counts: total units and missing artifacts. $1 = table path.
set -euo pipefail
jq -c '{units: length, failed: [.[] | select(.result == "missing")] | length}' "$1"
