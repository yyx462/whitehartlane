import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CountRow } from "./hooks.ts"

export type Report = {
  kind: "report"
  status: "done" | "failed" | "canary-stopped"
  counts: Record<string, number>
  table: { unit: string; result: string }[]
  where: string
}

export type ReportRow = { unit: string; result: string; pass: boolean }

export function writeReport(
  taskDir: string,
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
