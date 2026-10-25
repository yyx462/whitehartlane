import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { writeReport } from "../src/core/report.ts"
import { contentHashOf } from "../src/doors/project.ts"
import { createJob, failedWakeWhy, openSession } from "../src/adapters/store.ts"

// #197 — a verdict hook's red is a ROW, not a crash: the report always
// lands, the why rides the table, and the wake names a real file.
test("a throwing counts hook still produces an honest failed report", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-red-"))
  const rows = [{ unit: "worker-1", result: "did the work", pass: true }]
  const report = writeReport(
    dir,
    dir,
    rows,
    () => {
      throw new Error("counts hook exited 1: bash hooks/audit.sh")
    },
  )
  assert.equal(report.status, "failed", "the red verdict fails the report, not the run's plumbing")
  assert.ok(readFileSync(join(dir, "report.json"), "utf8").includes("verdict hook failed"))
  const countsRow = report.table.find((r) => r.unit === "counts")
  assert.ok(countsRow, "the why is a row in the table")
  assert.match(countsRow!.result, /counts hook exited 1/)
  assert.equal(report.counts.failed, 1)
})

// the repair-ticket hint: a failed wake proves the cheapest next
// command when the program changed since booking (content-hash compare)
test("failedWakeWhy appends the continue hint only when the source changed", () => {
  const sess = openSession({ cwd: tmpdir() })
  const src = mkdtempSync(join(tmpdir(), "agentic-os-src-"))
  writeFileSync(join(src, "workflow.toml"), "name = \"x\"\n")
  const job = createJob(
    { sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "hint", dir: src },
  )
  job.spur = { project: "p-test", project_name: "hint", spur_id: "hint", content_hash: "stale", source: src }
  assert.equal(failedWakeWhy(job, "done"), "done")
  assert.match(failedWakeWhy(job, "failed"), /program changed since booking/, "hash differs → the hint names the cheap repair")
  // after the fix is COMMITTED to the same source, the hash matches and
  // the wake stays plain — no false hope
  job.spur.content_hash = contentHashOf(src)
  assert.equal(failedWakeWhy(job, "failed"), "failed")
  // a vanished source (reaped worktree) is honest without the hint
  rmSync(src, { recursive: true, force: true })
  assert.equal(failedWakeWhy(job, "failed"), "failed")
})
