#!/usr/bin/env bash
# divide — BROADCAST, deterministic (2026-11-05, the owner's ruling:
# the divider LLM is retired — "send all problems to all source
# agents, no dividing"; one fixer reads everything anyway, and the
# solo pane was the stage that kept dying on the run deadline).
#
# Gate law, same as prove: exit 0 means "feedback produced" (or
# "accept: none to produce"), NOT "accepted" — merge.sh owns that
# exit. Every source agent named by the authoring trace receives
# EVERY blocked finding; a human PR (no trace) routes all findings
# to feedback/author.md.
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
NODE_TEST_CONTEXT= PROG="$prog" node <<'EOF'
const fs = require("node:fs")
const path = require("node:path")
const prog = process.env.PROG
const err = (m) => { console.error(`divide: ${m}`); process.exit(1) }
const v = JSON.parse(fs.readFileSync(path.join(prog, "data", "review", "verdict.json"), "utf8"))
const fbDir = path.join(prog, "feedback")

const render = (b) => [
  `## ${b.id} — ${b.severity} (${b.lens})`,
  "",
  `- **claim**: ${b.claim}`,
  `- **location**: ${b.location?.file ?? "?"}${b.location?.line_start ? ":" + b.location.line_start : ""}`,
  b.invariant ? `- **invariant**: ${b.invariant}` : "",
  `- **scenario**: ${b.scenario ?? ""}`,
  `- **repro**: \`${b.repro?.command ?? "node --test " + (b.repro?.test_path ?? "?")}\` — expected failure: ${b.repro?.expected_failure ?? "?"}`,
  b.fix_guarantee ? `- **fix guarantee**: ${b.fix_guarantee}` : "",
  `- **outcome**: ${b.outcome ?? ""}`,
  "",
  "ADOPT: copy the repro test into the repo's own suite with the fix, assertion intact.",
  "",
].filter((x) => x !== "").join("\n")

if (v.verdict === "accept") {
  const residue = fs.existsSync(fbDir) ? fs.readdirSync(fbDir).length : 0
  if (residue > 0) err(`verdict is accept but feedback/ holds ${residue} file(s) — accepted PRs get no refine round`)
  const adopt = (v.adopt ?? []).map((a) => a.id)
  console.log(`divide: accept — no feedback${adopt.length ? `; adopt[] handover: ${adopt.join(", ")}` : ""}`)
  process.exit(0)
}

// the parties: one per unit the authoring run itself spawned; no
// trace (the normal human-PR case) is one author, not a problem
const traceUnits = path.join(prog, "data", "trace", "units")
const parties = fs.existsSync(traceUnits)
  ? fs.readdirSync(traceUnits).filter((d) => fs.statSync(path.join(traceUnits, d)).isDirectory())
  : []
const names = parties.length > 0 ? parties : ["author"]
const legal = new Set([...v.blocked.map((b) => b.id), ...(v.adopt ?? []).map((a) => a.id)])

fs.mkdirSync(fbDir, { recursive: true })
const body = [
  "# Review feedback — broadcast",
  "",
  `Every blocked finding from the review is below, verbatim — ALL of it is yours (broadcast ruling, 2026-11-05: no division; read all of it, fix what is yours, answer the rest with a recorded rejection).`,
  "",
  ...v.blocked.map(render),
].join("\n")

for (const name of names) fs.writeFileSync(path.join(fbDir, `${name}.md`), body)

// MAP.md: the evidence trail ship-supervisor posts — broadcast shape
const map = [
  "# MAP — finding -> parties (broadcast)",
  "",
  ...v.blocked.map((b) => `${b.id} -> ${names.join(", ")} (broadcast: every source agent gets every finding)`),
  ...(v.adopt ?? []).length ? ["", `adopt[] handover: ${v.adopt.map((a) => a.id).join(", ")}`] : [],
  "",
].join("\n")
fs.writeFileSync(path.join(fbDir, "MAP.md"), map)

// self-verify (the old divide-check law, folded into the producer
// because the producer is deterministic now): every blocked finding
// in EVERY party file, MAP present, nothing invented
if (!fs.existsSync(path.join(fbDir, "MAP.md"))) err("MAP.md missing — the broadcast must carry its evidence")
for (const name of names) {
  const text = fs.readFileSync(path.join(fbDir, `${name}.md`), "utf8")
  for (const b of v.blocked) {
    if (!new RegExp(`\\b${b.id}\\b`).test(text)) err(`blocked finding ${b.id} missing from ${name}.md — this is a divide bug, report it`)
  }
  for (const m of text.matchAll(/\b(principles|tests|momentum|questions)-[a-z0-9-]+\b/g)) {
    if (!legal.has(m[0])) err(`${name}.md mentions ${m[0]} which is neither blocked nor adoptable — feedback never invents`)
  }
}
console.log(`divide: reject — broadcast ${v.blocked.length} blocked finding(s) to ${names.length} party file(s): ${names.join(", ")}`)
EOF
