#!/usr/bin/env bash
# Generic grade: a unit passes when the worker wrote a non-empty
# markdown artifact. The canary unit (marker units/$id/.grade-jev) also
# asks jev whether the file matches the brief. $1 = unit id.
set -uo pipefail
id="${1:?unit id}"
file="units/$id/result.md"
if [ ! -s "$file" ]; then
  printf 'missing\n'
  exit 1
fi
if [ -f "units/$id/.grade-jev" ]; then
  jev="${AGENTIC_OS_JEV:-jev}"
  out="$("$jev" noul "Does this result match the task brief?" -s "$(head -c 2000 "$file")" 2>&1)" || {
    printf 'jev error\n'
    exit 1
  }
  p="$(printf '%s' "$out" | sed -n 's/.*noul: *\([0-9.][0-9.]*\).*/\1/p' | head -1)"
  if [ -z "$p" ]; then
    printf 'jev error\n'
    exit 1
  fi
  awk -v p="$p" 'BEGIN { exit !(p+0 >= 0.5) }' || {
    printf 'jev no\n'
    exit 1
  }
fi
printf 'written\n'
exit 0
