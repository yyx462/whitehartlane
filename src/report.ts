import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type Report = {
  kind: "report"
  status: "done" | "failed"
  counts: Record<string, number>
  table: { unit: string; result: string }[]
  where: string
}

export type ReportRow = { unit: string; result: string; pass: boolean }

export function writeReport(
  taskDir: string,
  where: string,
  rows: ReportRow[],
  counts: (rows: { unit: string; result: string }[]) => Record<string, number>,
): Report {
  const body: Report = {
    kind: "report",
    status: rows.some((row) => !row.pass) ? "failed" : "done",
    counts: counts(rows.map(({ unit, result }) => ({ unit, result }))),
    table: rows.map(({ unit, result }) => ({ unit, result })),
    where,
  }
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, "report.json"), JSON.stringify(body, null, 2))
  return body
}
