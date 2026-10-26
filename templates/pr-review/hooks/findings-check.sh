#!/usr/bin/env bash
# findings-check — the lenses stage's own verdict (per unit, while the
# lens still lives: red = ONE revise round for exactly this unit, then
# an honest fail). Shape ONLY — parseable JSONL, required fields,
# P0/P1 carry a repro, coverage is a receipt, not a formality. Truth
# is prove's job (a finding that cannot be proven can never block).
# The rail sets WHL_UNIT to the unit being judged.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
unit="${WHL_UNIT:?findings-check needs WHL_UNIT — the rail sets it at the unit's check}"
dir="$prog/units/$unit"
fail() { echo "findings-check: $unit: $1" >&2; exit 1; }

[ -d "$dir" ] || fail "unit dir missing"
[ -f "$dir/findings.jsonl" ] || fail "findings.jsonl missing — write it even when empty (no findings is a claim your coverage must back)"
[ -f "$dir/coverage.md" ] || fail "coverage.md missing — 'no findings' is ambiguous without the receipt of what you checked"

node - "$dir/findings.jsonl" "$unit" <<'EOF' || exit 1
const [file, unit] = process.argv.slice(2)
const lines = require("node:fs").readFileSync(file, "utf8").split("\n").filter((l) => l.trim())
const req = ["id", "lens", "severity", "claim", "location"]
for (const [n, line] of lines.entries()) {
  let f
  try { f = JSON.parse(line) } catch { console.error(`findings-check: ${unit}: line ${n + 1} is not JSON`); process.exit(1) }
  for (const k of req) if (!(k in f)) { console.error(`findings-check: ${unit}: line ${n + 1} missing field ${k}`); process.exit(1) }
  if (f.lens !== unit) { console.error(`findings-check: ${unit}: line ${n + 1} lens is ${f.lens}, expected ${unit}`); process.exit(1) }
  if (!String(f.id).startsWith(unit + "-")) { console.error(`findings-check: ${unit}: line ${n + 1} id ${f.id} must be prefixed ${unit}-`); process.exit(1) }
  if (!["P0", "P1", "P2", "P3"].includes(f.severity)) { console.error(`findings-check: ${unit}: line ${n + 1} severity ${f.severity} not in P0..P3`); process.exit(1) }
  if (!f.claim || !f.location?.file) { console.error(`findings-check: ${unit}: line ${n + 1} claim/location.file empty`); process.exit(1) }
  if ((f.severity === "P0" || f.severity === "P1") && !f.repro?.test_path) {
    console.error(`findings-check: ${unit}: ${f.id} is ${f.severity} without repro.test_path — downgrade to P2 or write the repro`)
    process.exit(1)
  }
}
console.log(`${lines.length} findings, shape ok`)
EOF

# the coverage receipt: every decision traced, sites checked with
# file:line. Thin coverage + empty findings = a lens that did not look.
refs=$(grep -cE '[A-Za-z0-9._/-]+:[0-9]+' "$dir/coverage.md" || true)
[ "$refs" -ge 3 ] || fail "coverage.md carries only $refs file:line references (need >=3) — an empty findings file with thin coverage is rejected"

echo "findings-check: $unit ok"
