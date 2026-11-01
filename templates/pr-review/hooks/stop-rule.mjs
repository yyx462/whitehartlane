#!/usr/bin/env node
// hooks/stop-rule.mjs — the cold twin of src/doors/stop-rule.ts.
// merge.sh's reject arm calls this with the round's verdict and the
// PRIOR rounds' bucket history (STOP_HISTORY from config.sh — the
// door's writer); the eligibility math must MATCH the module's (the
// writer≡reader law — pinned by test/stop-rule.test.ts's round-trip).
// Prints ONE banner line to stdout when the gate declares eligibility
// (silence otherwise — not-eligible is the ordinary state, not news),
// and records the fact at data/review/stop.json (an output seat —
// identity-neutral in contentHashOf).
//
// argv: <verdict.json> <STOP_HISTORY json> <STOP_CFG json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const [verdictPath, historyRaw, cfgRaw] = process.argv.slice(2)
const DEFAULT_STOP = { rounds: 2, novelMax: 1, minRounds: 2 }
const cfg = { ...DEFAULT_STOP, ...JSON.parse(cfgRaw || "{}") }
const verdict = JSON.parse(readFileSync(verdictPath, "utf8"))
// prior entries: { buckets: [...], p0: bool } — oldest first (the
// door's writer). The P0 flag must ride down because the window's
// P0 check spans rounds, and buckets alone cannot answer it.
const prior = JSON.parse(historyRaw || "[]")

const bucketOf = (b) => {
  const file = (b.location?.file ?? "?").split("/").pop() ?? "?"
  return `${file}:${Math.floor((b.location?.line_start ?? 0) / 40)}`
}
const clustersOf = (blocked) => [...new Set((blocked ?? []).map(bucketOf))].sort()
const curBlocked = verdict.blocked ?? []
const history = [...prior.map((r) => r.buckets ?? []), clustersOf(curBlocked)]
const p0 = curBlocked.some((b) => b.severity === "P0") || prior.some((r) => r.p0 === true)
const rounds = history.length
const cur = history[rounds - 1] ?? []
const prv = history[rounds - 2] ?? []
const novel = prv.length ? cur.filter((x) => !prv.includes(x)).length : cur.length
const stuck = prv.length ? cur.filter((x) => prv.includes(x)) : []
const window = history.slice(-cfg.rounds)
const quiet = window.every((r, i) => {
  const before = history[history.length - window.length + i - 1]
  if (!before) return false
  const n = before.length ? r.filter((x) => !before.includes(x)).length : r.length
  const s = before.length ? r.filter((x) => before.includes(x)) : []
  return n <= cfg.novelMax && s.length === 0
})
const eligible = rounds >= cfg.minRounds && !p0 && novel <= cfg.novelMax && stuck.length === 0 && quiet

const fact = { eligible, novel, stuck, rounds, at: new Date().toISOString() }
try {
  const seat = join(dirname(verdictPath), "stop.json")
  mkdirSync(dirname(seat), { recursive: true })
  writeFileSync(seat, JSON.stringify(fact) + "\n")
} catch {
  // the record is best-effort here; the door recomputes from real history
}
if (eligible) {
  console.log(
    `merge: the gate declares diminishing returns — novel root causes ${novel} ≤ ${cfg.novelMax} for ${cfg.rounds} consecutive round(s), no stuck bucket; the owner may end this review: whl ship <repo> --pr <n> --overrule <file.json> (every blocked finding answered, recorded)`,
  )
}
