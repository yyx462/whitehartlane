#!/usr/bin/env bash
set -uo pipefail
id="${1:?unit id}"
if [ -s "units/$id/result.md" ]; then
  printf 'found\n'
  exit 0
fi
printf 'missing\n'
exit 1
