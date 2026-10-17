import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-regrade-"))

import { homeRoot } from "../src/store.ts"
import { regradeJob } from "../src/resume.ts"
import { readReport } from "../src/report.ts"
import { readCheckpoints, readState } from "../src/state.ts"

// #144 — regrade: a terminal Job re-enters at the GRADE card only.
// Worker output (the done marker) is the ticket; units that never
// produced output are named as needsRerun, never guessed at.

function stageJob(opts: {
  gradeHook: string
  unitDone: boolean
  state: "retired" | "running"
}): { sid: string; jid: string; taskDir: string } {
  // a minimal OS disk: one session, one job, one staged run dir
  const sid = "s-test01"
  const jid = "j-reg01"
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
  writeFileSync(join(taskDir, "state.json"), JSON.stringify({ done: [], failed: ["u1"] }))
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
  return { sid, jid, taskDir }
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
  const r = regradeJob("j-reg01")
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
