#!/usr/bin/env bash
set -uo pipefail
# the counts contract (issue #121): a JSON OBJECT of numbers. These
# fixtures predate it and printed a bare number / a bare word — the
# admission probe rightly refused them (as an "empty object"), which
# silently no-opped the whole e2e battery.
if [ -f results.json ]; then printf '{"found": 1}\n'; exit 0; fi
printf '{"found": 0}\n'
