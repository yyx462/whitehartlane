#!/usr/bin/env bash
set -uo pipefail
if [ -f results.json ]; then printf "found\n"; exit 0; fi
printf "0\n"
