import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CountRow } from "./hooks.ts"

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
  const body: Report = {
    kind: "report",
    status: status ?? (rows.some((row) => !row.pass) ? "failed" : "done"),
    counts: counts(rows.map(({ unit, result, pass }) => ({ unit, result, pass }))),
    table: rows.map(({ unit, result }) => ({ unit, result })),
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
