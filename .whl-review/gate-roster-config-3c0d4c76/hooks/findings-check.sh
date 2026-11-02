#!/usr/bin/env bash
# findings-check — the lenses stage's own verdict (per unit, while the
# lens still lives: red = ONE revise round for exactly this unit, then
# an honest fail). Shape ONLY — parseable JSONL, required fields,
# P0/P1 carry a repro, coverage is a receipt, not a formality. Truth
# is prove's job (a finding that cannot be proven can never block).
# The rail sets WHL_UNIT to the unit being judged.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
unit="${WHL_UNIT:?findings-check needs WHL_UNIT — the rail sets it at the check of the unit being judged}"
dir="$prog/units/$unit"
fail() { echo "findings-check: $unit: $1" >&2; exit 1; }

[ -d "$dir" ] || fail "unit dir missing"
[ -f "$dir/findings.jsonl" ] || fail "findings.jsonl missing — write it even when empty (no findings is a claim your coverage must back)"
[ -f "$dir/coverage.md" ] || fail "coverage.md missing — 'no findings' is ambiguous without the receipt of what you checked"

# NODE_TEST_CONTEXT= : a hook's node must never inherit the test
# runner's child protocol (it changes exit semantics under --test)
# NODE_TEST_CONTEXT= : a hook's node must never inherit the test
# runner's child protocol (it changes exit semantics under --test)
NODE_TEST_CONTEXT= node - "$dir/findings.jsonl" "$unit" <<'EOF' || exit 1
const [file, unit] = process.argv.slice(2)
const MODEL = `{"id":"${unit}-1","lens":"${unit}","severity":"P1","claim":"one sentence","location":{"file":"src/x.ts","line_start":1},"repro":{"test_path":"test/review/${unit}-1.test.ts","command":"node --test test/review/${unit}-1.test.ts"}}`
const teach = (why) => { console.error(`findings-check: ${unit}: ${why}\nfindings-check: ${unit}: the required shape, one object per line (extra fields allowed):\n  ${MODEL}`); process.exit(1) }
const lines = require("node:fs").readFileSync(file, "utf8").split("\n").filter((l) => l.trim())
const req = ["id", "lens", "severity", "claim", "location"]
for (const [n, line] of lines.entries()) {
  let f
  try { f = JSON.parse(line) } catch { teach(`line ${n + 1} is not JSON`) }
  for (const k of req) if (!(k in f)) teach(`line ${n + 1} missing field ${k}`)
  if (f.lens !== unit) teach(`line ${n + 1} lens is '${f.lens}', expected exactly '${unit}'`)
  if (!String(f.id).startsWith(unit + "-")) teach(`line ${n + 1} id '${f.id}' must be prefixed '${unit}-'`)
  if (!["P0", "P1", "P2", "P3"].includes(f.severity)) teach(`line ${n + 1} severity '${f.severity}' not in P0..P3`)
  if (!f.claim || !f.location?.file) teach(`line ${n + 1} claim/location.file empty`)
  if ((f.severity === "P0" || f.severity === "P1") && !f.repro?.test_path) {
    teach(`${f.id} is ${f.severity} without repro.test_path — downgrade to P2 or write the repro`)
  }
}
console.log(`${lines.length} findings, shape ok`)
EOF

# the coverage receipt: every decision traced, sites checked with
# file:line. Thin coverage + empty findings = a lens that did not look.
refs=$({ grep -oE '[A-Za-z0-9._/-]+:[0-9]+' "$dir/coverage.md" || true; } | wc -l | tr -d ' ')
[ "$refs" -ge 3 ] || fail "coverage.md carries only $refs file:line references (need >=3) — an empty findings file with thin coverage is rejected"

echo "findings-check: $unit ok"
