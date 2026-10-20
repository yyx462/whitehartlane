import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-regrade-"))

import { homeRoot, findJobByDir, listJobs, readEvents } from "../src/adapters/store.ts"
import { regradeJob } from "../src/doors/resume.ts"
import { readReport } from "../src/core/report.ts"
import { checkpoint, readCheckpoints, readState, settle } from "../src/core/state.ts"

// #144 — regrade: a terminal Job re-enters at the GRADE card only.
// Worker output (the done marker) is the ticket; units that never
// produced output are named as needsRerun, never guessed at.

let staged = 0
function stageJob(opts: {
  gradeHook: string
  unitDone: boolean
  state: "retired" | "running"
  store?: "legacy" | "ledger"
}): { sid: string; jid: string; taskDir: string } {
  // a minimal OS disk: one session, one job, one staged run dir
  staged += 1
  const sid = `s-test${staged.toString().padStart(2, "0")}`
  const jid = `j-reg${staged.toString().padStart(2, "0")}`
  const taskDir = join(homeRoot(), "sessions", sid, "jobs", jid, "run")
  mkdirSync(join(taskDir, "hooks"), { recursive: true })
  writeFileSync(
    join(taskDir, "workflow.toml"),
    [
      "[workflow]",
      'name = "regrade-fixture"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "bash hooks/grade.sh"',
      "",
      "[report]",
      'where = "units/"',
      "",
    ].join("\n"),
  )
  writeFileSync(join(taskDir, "hooks", "grade.sh"), `#!/usr/bin/env bash\n${opts.gradeHook}\n`)
  writeFileSync(join(taskDir, "units.jsonl"), `${JSON.stringify({ id: "u1", brief: "do the task" })}\n`)
  const unitDir = join(taskDir, "units", "u1")
  mkdirSync(unitDir, { recursive: true })
  if (opts.unitDone) writeFileSync(join(unitDir, "log.txt"), `working\ndone u1\n`)
  else writeFileSync(join(unitDir, "log.txt"), `working\n`)
  if (opts.store !== "ledger") {
    writeFileSync(join(taskDir, "state.json"), JSON.stringify({ done: [], failed: ["u1"] }))
  }
  writeFileSync(
    join(taskDir, "report.json"),
    JSON.stringify({
      kind: "report",
      status: "canary-stopped(grade-fault)",
      counts: { pass: 0, fail: 1 },
      table: [{ unit: "u1", result: "grade-fault: exit 127" }],
      where: "units/",
    }),
  )
  // the Job record (listJobs scans sessions/*/jobs/*/job.json): created
  // rides the sort, dir points straight at the staged run
  writeFileSync(
    join(homeRoot(), "sessions", sid, "jobs", jid, "job.json"),
    JSON.stringify({
      id: jid,
      sid,
      state: opts.state,
      workflow: "fan-out",
      task: "regrade-fixture",
      dir: taskDir,
      created: "2026-10-17T00:00:00.000Z",
      panes: [],
    }),
  )
  if (opts.store === "ledger") ledgerCards(taskDir)
  return { sid, jid, taskDir }
}

function ledgerCards(taskDir: string): void {
  checkpoint(taskDir, "unit:u1", "info", "worker output landed", "u1")
  checkpoint(taskDir, "grade:u1", "FAILED", "exit 1", "u1")
}

test("regrade re-enters at the grade card: hook now passes, report flips, worker never re-runs", () => {
  const { jid, taskDir } = stageJob({
    gradeHook: `echo "verifier pass"; exit 0`,
    unitDone: true,
    state: "retired",
  })
  const r = regradeJob(jid)
  assert.equal(r.ok, true)
  assert.equal(r.regraded.length, 1)
  assert.equal(r.regraded[0]!.pass, true)
  // state projection flipped failed → done, no duplicate
  const state = readState(taskDir)
  assert.deepEqual(state, { done: ["u1"], failed: [] })
  // report rewritten honestly
  const report = readReport(taskDir)
  assert.equal(report?.status, "done")
  assert.equal(report?.table[0]?.result, "verifier pass")
  // the stage ledger recorded the re-entry
  const cps = readCheckpoints(taskDir)
  assert.ok(cps.some((c) => c.stage === "grade:u1:regrade" && c.status === "ok"))
  assert.ok(cps.some((c) => c.stage === "report:regrade"))
})

test("regrade still failing keeps the honest row — and does not pretend", () => {
  const { jid } = stageJob({
    gradeHook: `echo "FAIL"; exit 1`,
    unitDone: true,
    state: "retired",
  })
  const r = regradeJob(jid)
  assert.equal(r.ok, true)
  assert.equal(r.regraded[0]!.pass, false)
  assert.equal(r.regraded[0]!.row, "FAIL")
})

test("units without worker output are named needsRerun — never guessed at", () => {
  const { jid } = stageJob({
    gradeHook: `echo ok; exit 0`,
    unitDone: false,
    state: "retired",
  })
  const r = regradeJob(jid)
  assert.equal(r.ok, false)
  assert.deepEqual(r.needsRerun, ["u1"])
  assert.match(r.why ?? "", /rerun/)
})

test("a running job refuses regrade — live runs are not terminal", () => {
  const { jid } = stageJob({ gradeHook: `exit 0`, unitDone: true, state: "running" })
  const r = regradeJob(jid)
  assert.equal(r.ok, false)
  assert.match(r.why ?? "", /running/)
})

test("unknown job ids say so", () => {
  const r = regradeJob("j-nope")
  assert.equal(r.ok, false)
  assert.match(r.why ?? "", /no such job/)
})

// ── the unit ledger fold (OPTIMUM §4: one store, state.json deleted) ──

test("the fold: info never settles, last card wins, order is card order", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-ledger-"))
  checkpoint(dir, "unit:a", "info", "worker output landed", "a") // observes only
  checkpoint(dir, "grade:a", "FAILED", "exit 1", "a")
  settle(dir, "b", "unit:b", true, "found")
  settle(dir, "c", "unit:c", false, "stalled")
  settle(dir, "a", "grade:a:regrade", true, "verifier pass") // flip by append
  assert.deepEqual(readState(dir), { done: ["b", "a"], failed: ["c"] })
  assert.equal(existsSync(join(dir, "state.json")), false, "no second store is ever written")
})

test("a legacy state.json wins its own read — its ledger is half-full", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-ledger-legacy-"))
  settle(dir, "u1", "unit:u1", true, "found")
  writeFileSync(join(dir, "state.json"), JSON.stringify({ done: ["u1"], failed: ["u2"] }))
  assert.deepEqual(readState(dir), { done: ["u1"], failed: ["u2"] })
})

// ── the events fold (OPTIMUM §8: cards ride the OS-disk trace) ──────

test("a card IS a trace event — the task dir keeps no ledger file", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-trace-"))
  settle(dir, "u1", "unit:u1", true, "found")
  // no second store is ever written: the dir holds the delivery
  // interface only; the card lives on the session trace
  assert.equal(existsSync(join(dir, "checkpoints.jsonl")), false)
  const job = findJobByDir(dir)
  assert.ok(job, "a dir that settles mints its job record")
  const card = readEvents(job!.sid).find((e) => e.kind === "unit.card")
  assert.ok(card)
  assert.equal(card!.dir, dir)
  assert.deepEqual(
    { stage: card!.stage, status: card!.status, unit: card!.unit, detail: card!.detail },
    { stage: "unit:u1", status: "ok", unit: "u1", detail: "found" },
  )
})

test("reads never mint — a jobless dir's readState is empty and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-read-only-"))
  const before = listJobs().length
  assert.deepEqual(readState(dir), { done: [], failed: [] })
  assert.equal(listJobs().length, before, "a read must not write the disk")
})

test("a pre-fold checkpoints.jsonl folds read-only, strictly before the trace's cards", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-pre-fold-"))
  writeFileSync(
    join(dir, "checkpoints.jsonl"),
    `${JSON.stringify({ ts: "2026-10-19T00:00:00.000Z", stage: "grade:u1", status: "FAILED", unit: "u1", detail: "exit 1" })}\n`,
  )
  // a post-fold card joins the same ledger (a regrade, say) — the file
  // is never rewritten, it only folds first because it is older
  settle(dir, "u2", "unit:u2", true, "found")
  assert.deepEqual(readState(dir), { done: ["u2"], failed: ["u1"] })
  const file = readFileSync(join(dir, "checkpoints.jsonl"), "utf8")
  assert.ok(!file.includes("u2"), "the legacy file is never appended to")
})

test("regrade on a ledger-only dir flips by card; no state.json appears", () => {
  const { jid, taskDir } = stageJob({
    gradeHook: `echo "verifier pass"; exit 0`,
    unitDone: true,
    state: "retired",
    store: "ledger",
  })
  const r = regradeJob(jid)
  assert.equal(r.ok, true)
  assert.equal(r.regraded[0]!.pass, true)
  assert.deepEqual(readState(taskDir), { done: ["u1"], failed: [] })
  assert.equal(existsSync(join(taskDir, "state.json")), false)
  assert.ok(readCheckpoints(taskDir).some((c) => c.stage === "grade:u1:regrade" && c.unit === "u1"))
})
