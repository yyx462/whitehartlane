#!/usr/bin/env bash
# divide-check — the divide stage's own verdict (solo check, one revise
# round on red). Judges the DIVISION, not the review: on reject every
# blocked finding reaches exactly one feedback file, no invented
# findings, MAP carries the evidence; on accept NO feedback exists
# (accepted PRs need no refine round — a feedback file after an accept
# is residue).
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "divide-check: $1" >&2; exit 1; }
node <<'EOF' || exit 1
const fs = require("node:fs")
const path = require("node:path")
const prog = process.env.PROG ?? path.resolve(process.argv[1] ?? ".", "..", "..")
const v = JSON.parse(fs.readFileSync(path.join(prog, "review", "verdict.json"), "utf8"))
const fbDir = path.join(prog, "feedback")
const files = fs.existsSync(fbDir) ? fs.readdirSync(fbDir).filter((f) => f.endsWith(".md") && f !== "MAP.md") : []
const err = (m) => { console.error(`divide-check: ${m}`); process.exit(1) }
if (v.verdict === "accept") {
  if (files.length > 0) err(`verdict is accept but feedback/ holds ${files.length} file(s) — accepted PRs get no refine round`)
  console.log("divide-check: accept, no feedback — correct")
} else {
  if (files.length === 0) err("verdict is reject but feedback/ is empty — nobody was told")
  if (!fs.existsSync(path.join(fbDir, "MAP.md"))) err("feedback/MAP.md missing — the division must carry its evidence")
  const blockedIds = v.blocked.map((b) => b.id)
  const seen = new Map()
  for (const f of files) {
    const text = fs.readFileSync(path.join(fbDir, f), "utf8")
    for (const id of blockedIds) {
      const n = (text.match(new RegExp(`\\b${id}\\b`, "g")) ?? []).length
      if (n > 0) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    // invented findings: ids that look like findings but are not blocked
    for (const m of text.matchAll(/\b(principles|tests|momentum|questions)-[a-z0-9-]+\b/g)) {
      if (!blockedIds.includes(m[0])) err(`${f} mentions ${m[0]} which is not a blocked finding — feedback never invents`)
    }
  }
  for (const id of blockedIds) {
    const n = seen.get(id) ?? 0
    if (n === 0) err(`blocked finding ${id} reaches nobody`)
    if (n > 1) err(`blocked finding ${id} reaches ${n} feedback files — exactly one owner per finding`)
  }
  console.log(`divide-check: reject, ${files.length} feedback file(s), all ${blockedIds.length} blocked findings covered exactly once`)
}
EOF
