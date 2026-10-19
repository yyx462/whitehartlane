#!/usr/bin/env bash
# Counts hook: table JSON in $1; prints a JSON object of counts.
set -euo pipefail
jq -c '{lookups: length, failed: [.[] | select(.result == "missing")] | length}' "$1"
