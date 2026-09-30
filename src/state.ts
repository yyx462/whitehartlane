import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ReportRow } from "./report.ts"

export type Settled = { done: string[]; failed: string[] }

export function writeUnitsSnapshot(
  taskDir: string,
  units: { id: string; brief: string }[],
): void {
  mkdirSync(taskDir, { recursive: true })
  const body = units.map((unit) => JSON.stringify(unit)).join("\n")
  writeFileSync(join(taskDir, "units.jsonl"), `${body}\n`)
}

export function readState(taskDir: string): Settled {
  const path = join(taskDir, "state.json")
  if (!existsSync(path)) return { done: [], failed: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Settled>
    return { done: parsed.done ?? [], failed: parsed.failed ?? [] }
  } catch {
    return { done: [], failed: [] }
  }
}

export function settleUnit(
  taskDir: string,
  unitId: string,
  pass: boolean,
  row?: ReportRow,
): Settled {
  const state = readState(taskDir)
  ;(pass ? state.done : state.failed).push(unitId)
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, "state.json"), JSON.stringify(state, null, 2))
  return state
}
