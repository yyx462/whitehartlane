#!/usr/bin/env bash
set -euo pipefail
jq -c '{units: length, failed: [.[] | select(.pass != true)] | length}' "$1"
