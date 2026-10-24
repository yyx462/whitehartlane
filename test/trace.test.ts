import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-trace-"))

const { appendEvent, createJob, openSession } = await import("../src/adapters/store.ts")
const { emitTrace, readTrace, jobTracePath, sessionTracePath, TRACE_COLUMNS, renderTraceTable } = await import("../src/adapters/trace.ts")

const sid = "s-trace"
openSession({ cwd: tmpdir() })

test("a job's events land in the job file with header, seq, and columns", () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t1", runDir: true })
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.finished", unit: "fixer", pass: true, result: "ok", task: "t1" })

  const file = jobTracePath(sid, job.id)
  assert.ok(existsSync(file), "job trace file exists")
  const raw = readFileSync(file, "utf8").split("\n")
  assert.match(raw[0], /^#columns:/)
  assert.equal(raw[0].split("\t").length, TRACE_COLUMNS.length, "header declares every column")
  const rows = readTrace(file).rows
  assert.equal(rows.length, 2, "job.born then unit.finished")
  const fin = rows[1]
  assert.equal(fin.seq, 2, "job.born was seq 1, unit.finished is seq 2")
  assert.equal(fin.kind, "unit.finished")
  assert.equal(fin.jid, job.id, "jid rides the join key")
  assert.equal(fin.stage, "fixer", "payload.unit lands in the stage column")
  assert.equal(fin.verdict, "ok", "pass=true becomes verdict ok")
})

test("lineage kinds land in BOTH files; run-level kinds only in the job file", () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t2", runDir: true })
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "pane.born", label: "w-fixer-abc" })

  const jobRows = readTrace(jobTracePath(sid, job.id)).rows
  const sessRows = readTrace(sessionTracePath(sid)).rows

  assert.ok(jobRows.some((r) => r.kind === "job.born"), "job.born is in the job file")
  assert.ok(jobRows.some((r) => r.kind === "pane.born"), "pane.born is in the job file")
  assert.ok(sessRows.some((r) => r.kind === "job.born"), "job.born is in the session lineage")
  assert.ok(!sessRows.some((r) => r.kind === "pane.born"), "run-level volume never enters the session file")
})

test("a bracket pair carries dur_ms on the end event — the bottleneck column", async () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t3", runDir: true })
  const startAt = Date.now() - 60_000
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "stage.started", stage: "fixer", ts: new Date(startAt).toISOString() })
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.finished", unit: "fixer", pass: true })

  const rows = readTrace(jobTracePath(sid, job.id)).rows
  const fin = rows.find((r) => r.kind === "unit.finished")!
  assert.ok(fin.dur_ms >= 55_000 && fin.dur_ms <= 65_000, `dur_ms backfilled from the bracket partner (got ${fin.dur_ms})`)
})

test("a torn tail is skipped, a seq gap is named", () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t4", runDir: true })
  const file = jobTracePath(sid, job.id)
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.finished", unit: "a", pass: true })
  // simulate a short write: half a line at the tail, seq jumped
  writeFileSync(file, `${readFileSync(file, "utf8")}5\t1792`, { flag: "a" })

  const read = readTrace(file)
  assert.equal(read.tornTail, true, "the half line is detected as a torn tail")
  assert.ok(read.rows.length >= 2, "parsable rows survive")

  // simulate a lost interior line: rewrite with a seq hole
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l && !l.startsWith("#"))
  writeFileSync(file, `${readFileSync(file, "utf8").split("\n")[0]}\n${lines[0]}\n${lines[1].replace(/^(\d+)/, "9")}\n`)
  const gapped = readTrace(file)
  assert.equal(gapped.gaps.length, 1, "the seq jump is reported as a gap")
})

test("writer ≡ reader round-trip: every field survives the TSV encoding", () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t5", runDir: true })
  appendEvent(sid, { actor: "gate", jid: job.id, kind: "gate.settled", stage: "gate", obj: "pr=192", verdict: "fail", note: "one\ttwo\nthree" })
  const row = readTrace(jobTracePath(sid, job.id)).rows.find((r) => r.kind === "gate.settled")!
  assert.equal(row.actor, "gate")
  assert.equal(row.stage, "gate")
  assert.equal(row.obj, "pr=192")
  assert.equal(row.verdict, "fail")
  const payload = JSON.parse(row.detail)
  assert.equal(payload.note, "one\ttwo\nthree", "tab/newline payload survives the escape round-trip")
  assert.ok(renderTraceTable(jobTracePath(sid, job.id)).includes("gate.settled"))
})

test("emitTrace never throws on a broken environment (best-effort surface)", () => {
  const before = process.env.AGENTIC_OS_HOME
  process.env.AGENTIC_OS_HOME = "/dev/null/impossible"
  emitTrace("s-x", { actor: "t", kind: "job.born", jid: "j-x" })
  process.env.AGENTIC_OS_HOME = before
})
