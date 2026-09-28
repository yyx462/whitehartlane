#!/usr/bin/env bash
# Grade hook: one unit id in $1. Exit 0 = pass. The first stdout line is
# the row the report table shows.
set -uo pipefail
id="${1:?unit id}"
if [ -s "results/$id.txt" ]; then
  printf 'found\n'
  exit 0
fi
printf 'missing\n'
exit 1
