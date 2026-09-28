#!/usr/bin/env bash
# Units hook: one JSONL line per unit. The brief is the worker's whole
# assignment. Unit ids must be shep-safe: [a-z][a-z0-9_-]{0,31}.
set -euo pipefail
cat <<'EOF'
{"id":"france","brief":"Look up the capital of France. Write the city name to results/france.txt. One line, nothing else."}
{"id":"japan","brief":"Look up the capital of Japan. Write the city name to results/japan.txt. One line, nothing else."}
{"id":"peru","brief":"Look up the capital of Peru. Write the city name to results/peru.txt. One line, nothing else."}
EOF
