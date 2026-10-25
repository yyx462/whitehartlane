import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CountRow } from "../doors/hooks.ts"

export type Report = {
  kind: "report"
  status: "done" | "failed" | "canary-stopped" | "canary-stopped(grade-fault)"
  counts: Record<string, number>
  table: { unit: string; result: string }[]
  where: string
}

export type ReportRow = { unit: string; result: string; pass: boolean }

export function writeReport(  taskDir: string,
  where: string,
  rows: ReportRow[],
  counts: (rows: CountRow[]) => Record<string, number>,
  status?: Report["status"],
): Report {
  let finalRows = rows
  let counted: Record<string, number>
  try {
    counted = counts(rows.map(({ unit, result, pass }) => ({ unit, result, pass })))
  } catch (err) {
    // #197 — a verdict hook's red is a ROW, not a crash: the report
    // always lands (the wake names a real file; `whl continue` can
    // re-run the verdict on the same work). The hook's why rides the
    // table; the built-in counter keeps the numbers honest.
    const why = (err instanceof Error ? err.message : String(err)).split("\n")[0]
    finalRows = [...rows, { unit: "counts", result: `verdict hook failed: ${why.slice(0, 160)}`, pass: false }]
    counted = {
      units: finalRows.length,
      passed: finalRows.filter((r) => r.pass).length,
      failed: finalRows.filter((r) => !r.pass).length,
    }
  }
  const body: Report = {
    kind: "report",
    status: status ?? (finalRows.some((row) => !row.pass) ? "failed" : "done"),
    counts: counted,
    table: finalRows.map(({ unit, result }) => ({ unit, result })),
    where,
  }
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, "report.json"), JSON.stringify(body, null, 2))
  return body
}

// The prior report, if any — regrade rewrites over it, keeping rows it
// did not touch. Absent/malformed reads as "no report yet".
export function readReport(taskDir: string): Report | null {
  const path = join(taskDir, "report.json")
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Report
  } catch {
    return null
  }
}
