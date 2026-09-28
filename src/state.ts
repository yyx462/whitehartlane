import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type Settled = { done: string[]; failed: string[] }

export function writeUnitsSnapshot(
  taskDir: string,
  units: { id: string; brief: string }[],
): void {
  mkdirSync(taskDir, { recursive: true })
  const body = units.map((unit) => JSON.stringify(unit)).join("\n")
  writeFileSync(join(taskDir, "units.jsonl"), `${body}\n`)
}

export function settleUnit(taskDir: string, unitId: string, pass: boolean): Settled {
  const path = join(taskDir, "state.json")
  let state: Settled = { done: [], failed: [] }
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Settled>
      state = { done: parsed.done ?? [], failed: parsed.failed ?? [] }
    } catch {
      state = { done: [], failed: [] }
    }
  }
  ;(pass ? state.done : state.failed).push(unitId)
  writeFileSync(path, JSON.stringify(state, null, 2))
  return state
}
