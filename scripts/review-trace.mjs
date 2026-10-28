#!/usr/bin/env node
// review-trace — the economics tracer for pr-review jobs (the 8-round
// receipt machine). For every review job on this machine: wall time,
// per-lens findings, token usage (from the opencode DB, keyed by the
// unit sandbox directories), and cross-round duplicate findings keyed
// by (file, invariant) — the measured answer to "where did the tokens
// go and what did we re-buy".
//
// Usage: node scripts/review-trace.mjs [--json] [jobId...]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// WHERE THE OS-DISK TRACE LIVES — the twin of store.ts homeRoot()
// (ADR 0011), which owns the decision; this .mjs cannot import that
// TS module, so the ternary is replicated here. IF YOU CHANGE ONE,
// CHANGE BOTH (r13 tests-3: hard-coding the legacy disk crashed with
// ENOENT on the default layout and broke the README's any-machine
// promise).
function traceRoot() {
  if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
  const next = join(homedir(), ".local", "share", "whitehartlane")
  const old = join(homedir(), ".local", "share", "agentic-os")
  return existsSync(old) && !existsSync(next) ? old : next
}

const AOS = join(traceRoot(), "sessions")
// the opencode DB is opencode's own XDG dir, not whl's decision
const DB = join(homedir(), ".local/share/opencode/opencode.db")
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const JSON_OUT = process.argv.includes("--json")

const q = (sql) => execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8" }).trim()

const jobs = []
// a machine where no session has landed yet has NO sessions dir —
// that is an empty report, not a crash (r14 tests-3: the raw ENOENT
// falsified the any-machine promise at first contact)
if (existsSync(AOS)) {
for (const sid of readdirSync(AOS)) {
  const sdir = join(AOS, sid, "jobs")
  if (!existsSync(sdir)) continue
  for (const jid of readdirSync(sdir)) {
    const run = join(sdir, jid, "run")
    if (!existsSync(join(run, "data", "review"))) continue
    if (only.length && !only.includes(jid)) continue
    const vpath = join(run, "data", "review", "verdict.json")
    const cfg = join(run, "data", "review", "config.sh")
    const log = join(run, "orchestrator.log")
    if (!existsSync(log)) continue
    let title = "?"
    if (existsSync(cfg)) {
      const m = readFileSync(cfg, "utf8").match(/^TITLE=(.*)$/m)
      if (m) title = m[1].replace(/^['"]|['"]$/g, "")
    }
    const v = existsSync(vpath)
      ? (() => {
          try {
            return JSON.parse(readFileSync(vpath, "utf8"))
          } catch {
            return null // a torn verdict is the crash's own receipt — skip it
          }
        })()
      : null
    // wall: first→last orchestrator log line
    const lines = readFileSync(log, "utf8").trim().split("\n")
    const ts = (l) => l.slice(0, 24)
    const t0 = new Date(ts(lines[0])).getTime()
    const t1 = new Date(ts(lines[lines.length - 1])).getTime()
    // units
    const units = {}
    const udir = join(run, "units")
    if (existsSync(udir)) {
      for (const u of readdirSync(udir)) {
        const f = join(udir, u, "findings.jsonl")
        const findings = existsSync(f)
          ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) // a mid-write artifact is the crash this tool explains — skip it
          : []
        units[u] = {
          findings: findings.length,
          keys: findings.map((x) => {
            const file = (x.location?.file ?? "?").replace(/.*\//, "")
            return `${file}:${x.invariant ?? "?"}`
          }),
        }
      }
    }
    jobs.push({
      jid, sid, title, run,
      head: v?.head?.slice(0, 8) ?? null,
      verdict: v?.verdict ?? "(died — no verdict)",
      blocked: v?.blocked?.length ?? null,
      advisory: v?.advisory?.length ?? null,
      wall_min: Math.round(((t1 - t0) / 60_000) * 10) / 10,
      start: ts(lines[0]),
      units, toks: {},
    })
  }
}
}

// token usage per unit sandbox — assistant rows in session_message
// carry per-step token usage; session_v2.directory maps them to units.
// No cost column: the provider integration reports none, and an
// unfed $0.00 is a claim, not a measurement (questions-1, r9).
// No DB (a machine where no lens ever ran) → no token columns, same
// empty report.
if (existsSync(DB))
try {
  const rows = q(
    `select s.directory d, sum(cast(json_extract(sm.data,'$.tokens.input') as integer)) tin,` +
      ` sum(cast(json_extract(sm.data,'$.tokens.output') as integer)) tout,` +
      ` sum(cast(json_extract(sm.data,'$.tokens.reasoning') as integer)) treas,` +
      ` sum(cast(json_extract(sm.data,'$.tokens.cache.read') as integer)) tcache,` +
      ` count(*) steps` +
      ` from session_message sm join session_v2 s on s.id = sm.session_id` +
      ` where sm.type='assistant' and s.directory like '%/jobs/%/run/%' group by s.directory`,
  )
  for (const r of JSON.parse(rows || "[]")) {
    const m = r.d.match(/\/jobs\/([^/]+)\/run\/(?:units\/)?([^/]+)/)
    const j = jobs.find((x) => x.jid === m?.[1])
    if (!j || !m) continue
    const t = j.toks[m[2]] ?? { kin: 0, kout: 0, kcache: 0, steps: 0 }
    j.toks[m[2]] = {
      kin: t.kin + (r.tin ?? 0),
      kout: t.kout + (r.tout ?? 0),
      kcache: t.kcache + (r.tcache ?? 0),
      steps: t.steps + (r.steps ?? 0),
    }
  }
} catch {
  /* db unreadable: economics columns stay empty */
}
jobs.sort((a, b) => (a.start < b.start ? -1 : 1))

// cross-round duplicates: (file:invariant) seen in >1 self-review round
const seen = new Map()
for (const j of jobs) {
  if (!/self-review|r\d/i.test(j.title)) continue
  for (const [, d] of Object.entries(j.units)) {
    for (const k of d.keys) {
      if (!seen.has(k)) seen.set(k, new Set())
      seen.get(k).add(j.jid)
    }
  }
}
const dups = [...seen.entries()].filter(([, s]) => s.size > 1)

if (JSON_OUT) {
  console.log(JSON.stringify({ jobs, dups: dups.map(([k, s]) => [k, [...s]]) }, null, 1))
} else {
  for (const j of jobs) {
    const K = Object.values(j.toks).reduce(
      (a, t) => ({ kin: a.kin + t.kin, kout: a.kout + t.kout, kcache: a.kcache + t.kcache }),
      { kin: 0, kout: 0, kcache: 0 },
    )
    console.log(
      `${j.jid}  ${j.start.slice(5, 16)}  ${String(j.wall_min).padStart(5)}min  ${j.verdict.padEnd(8)} b${j.blocked ?? "-"}/a${j.advisory ?? "-"}  ` +
        `in ${(K.kin / 1000).toFixed(0)}k out ${(K.kout / 1000).toFixed(0)}k cache ${(K.kcache / 1000).toFixed(0)}k  ${j.title.slice(0, 46)}`,
    )
    for (const [u, d] of Object.entries(j.units)) {
      const t = j.toks[u]
      console.log(
        `    ${u.padEnd(11)} f${String(d.findings).padStart(2)}  ${t ? `in ${(t.kin / 1000).toFixed(0)}k out ${(t.kout / 1000).toFixed(0)}k` : "(no session — dead pane)"}`,
      )
    }
  }
  console.log(`\ncross-round duplicate (file:invariant) keys: ${dups.length}`)
  for (const [k, s] of dups) console.log(`  ${k}  x${s.size} (${[...s].map((x) => x.slice(2, 6)).join(",")})`)
}
