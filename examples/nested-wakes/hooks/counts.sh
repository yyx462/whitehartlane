#!/usr/bin/env bash
set -euo pipefail
jq -c '{lookups: length, failed: [.[] | select(.result == "missing")] | length}' "$1"
