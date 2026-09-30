#!/usr/bin/env bash
# Generic grade: a unit passes when the worker wrote a non-empty
# markdown artifact. $1 = unit id.
set -uo pipefail
id="${1:?unit id}"
if [ -s "units/$id/result.md" ]; then
  printf 'written\n'
  exit 0
fi
printf 'missing\n'
exit 1
