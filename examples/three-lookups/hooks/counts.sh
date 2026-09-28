#!/usr/bin/env bash
# Counts hook: path to the settled table JSON in $1 (an array of
# {unit, result} rows). Prints a JSON object of named counts.
set -euo pipefail
jq -c '{lookups: length, failed: [.[] | select(.result == "missing")] | length}' "$1"
