#!/usr/bin/env bash
set -uo pipefail
# the counts contract (issue #121): a JSON OBJECT of numbers
if [ -s "units/forgot/result.md" ]; then printf '{"found": 1}\n'; exit 0; fi
printf '{"found": 0}\n'
