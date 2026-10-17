import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HookError, loadManifest, runGrade } from "./hooks.ts"
import { readReport, writeReport, type Report, type ReportRow } from "./report.ts"
import { checkpoint, readState, regradeUnit } from "./state.ts"
import { appendEvent, jobRunDir, listJobs, type JobRecord } from "./store.ts"

// regrade — the minimal-rerun resume (#144): a terminal Job whose units
// FAILED AT THE GRADE STAGE (worker output exists, hook verdict bad or
// faulty) re-enters at exactly that card. The worker never re-runs; the
// container may be long cold — the levy is expected to fix/bless the
// hook FIRST (the stage ledger says which stage failed), then one verb
// turns the night's mislabeled stops into honest reports.
//
// Units that failed WITHOUT worker output (blocked, killed, deadline)
// are not regradable — they need a rerun (a fresh booking; state.json
// spares the done units), and the receipt says so instead of guessing.

export type RegradeReceipt = {
  ok: boolean
  why?: string
  jid?: string
  dir?: string
  regraded: { unit: string; pass: boolean; row: string }[]
  needsRerun: string[]
  report?: Report
}

function unitLogHas(taskDir: string, unitId: string, marker: string): boolean {
  const logPath = join(taskDir, "units", unitId, "log.txt")
  if (!existsSync(logPath)) return false
  return readFileSync(logPath, "utf8").includes(marker)
}

export function regradeJob(jid: string): RegradeReceipt {
  const jobs = listJobs()
  const job = jobs.find((j) => j.id === jid)
  if (!job) return { ok: false, why: `no such job: ${jid}`, regraded: [], needsRerun: [] }
  if (job.state === "running") {
    return { ok: false, why: `job ${jid} is still running — pause or let it finish first`, regraded: [], needsRerun: [] }
  }
  const taskDir = job.dir || jobRunDir(job.sid, job.id)
  if (!existsSync(join(taskDir, "workflow.toml"))) {
    return { ok: false, why: `no staged program for ${jid}`, jid, regraded: [], needsRerun: [] }
  }

  let manifest
  try {
    manifest = loadManifest(taskDir)
  } catch (err) {
    const why = err instanceof HookError ? err.message : String(err)
    return { ok: false, why: `staged manifest unreadable: ${why}`, jid, regraded: [], needsRerun: [] }
  }

  const state = readState(taskDir)
  if (state.failed.length === 0) {
    return { ok: true, jid, regraded: [], needsRerun: [], report: readReport(taskDir) ?? undefined }
  }

  // units.jsonl is the staged unit list (writeUnitsSnapshot's shape)
  const unitsPath = join(taskDir, "units.jsonl")
  const units = existsSync(unitsPath)
    ? readFileSync(unitsPath, "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { id: string; brief: string })
    : []

  const regraded: RegradeReceipt["regraded"] = []
  const needsRerun: string[] = []
  for (const id of state.failed) {
    const unit = units.find((u) => u.id === id)
    if (!unit || !unitLogHas(taskDir, id, `done ${id}`)) {
      needsRerun.push(id)
      continue
    }
    const grade = runGrade(taskDir, manifest, unit)
    regradeUnit(taskDir, id, grade.pass)
    checkpoint(taskDir, `grade:${id}:regrade`, grade.pass ? "ok" : grade.fault ? "grade-fault" : "FAILED", grade.row)
    regraded.push({ unit: id, pass: grade.pass, row: grade.row })
  }

  if (regraded.length === 0) {
    return {
      ok: false,
      why: `no failed unit has worker output — rerun instead (a fresh booking spares the ${state.done.length} done units)`,
      jid,
      regraded,
      needsRerun,
    }
  }

  // rewrite the report over the prior rows: regraded rows replace in place
  const prior = readReport(taskDir)
  const settled = readState(taskDir)
  const rows: ReportRow[] = (prior?.table ?? units.map((u) => ({ unit: u.id, result: "" }))).map(
    ({ unit }) => {
      const hit = regraded.find((r) => r.unit === unit)
      if (hit) return { unit, result: hit.row, pass: hit.pass }
      return { unit, result: prior?.table.find((t) => t.unit === unit)?.result ?? "", pass: settled.done.includes(unit) }
    },
  )
  const report = writeReport(taskDir, prior?.where ?? "units/", rows, (tableRows) => builtinPassCounts(tableRows))
  checkpoint(taskDir, "report:regrade", "info", report.status)

  appendEvent(job.sid, {
    actor: "cli",
    kind: "regrade",
    job: jid,
    regraded: regraded.map((r) => `${r.unit}:${r.pass ? "pass" : "fail"}`).join(" "),
  })
  return { ok: true, jid, dir: taskDir, regraded, needsRerun, report }
}

function builtinPassCounts(rows: { pass: boolean }[]): Record<string, number> {
  return { pass: rows.filter((r) => r.pass).length, fail: rows.filter((r) => !r.pass).length }
}
