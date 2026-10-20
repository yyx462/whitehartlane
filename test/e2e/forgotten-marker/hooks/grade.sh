#!/usr/bin/env bash
set -uo pipefail
# marker-path compat: status-first never requires the marker, but an
# agent that writes one anyway must still settle through the grade path
id="${1:?unit id}"
if [ -s "units/$id/result.md" ]; then printf "found\n"; exit 0; fi
printf "missing\n"; exit 1
