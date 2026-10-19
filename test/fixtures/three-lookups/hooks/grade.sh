#!/usr/bin/env bash
# Grade hook: unit id in $1; first stdout line is the report row.
set -uo pipefail
id="${1:?unit id}"
if [ -s "units/$id/result.md" ]; then
  printf 'found\n'
  exit 0
fi
printf 'missing\n'
exit 1
