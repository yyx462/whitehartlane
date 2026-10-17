import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ReportRow } from "./report.ts"

export type Settled = { done: string[]; failed: string[] }

// The stage ledger (#144): every meaningful transition appends one line,
// keyed specific enough that `regrade` (and any future resume verb) can
// find the exact card that failed and re-enter THERE — never the journey.
export type CheckpointStatus = "ok" | "FAILED" | "grade-fault" | "info"
export type Checkpoint = { ts: string; stage: string; status: CheckpointStatus; detail?: string }

export function checkpoint(
  taskDir: string,
  stage: string,
  status: CheckpointStatus,
  detail?: string,
): void {
  mkdirSync(taskDir, { recursive: true })
  const entry: Checkpoint = { ts: new Date().toISOString(), stage, status }
  if (detail) entry.detail = detail
  appendFileSync(join(taskDir, "checkpoints.jsonl"), `${JSON.stringify(entry)}\n`)
}

export function readCheckpoints(taskDir: string): Checkpoint[] {
  const path = join(taskDir, "checkpoints.jsonl")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as Checkpoint
      } catch {
        return { ts: "", stage: "unparsable", status: "info" as const, detail: line.slice(0, 80) }
      }
    })
}

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

export function finishUnit(
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

// A re-grade flips a unit's settled side without duplicating it (the
// stage ledger's whole point: the WORKER card stays, only the GRADE
// card re-enters). state.json stays the resume projection it always was.
export function regradeUnit(taskDir: string, unitId: string, pass: boolean): Settled {
  const state = readState(taskDir)
  if (pass) {
    state.failed = state.failed.filter((id) => id !== unitId)
    if (!state.done.includes(unitId)) state.done.push(unitId)
  } else if (!state.failed.includes(unitId)) {
    state.failed.push(unitId)
  }
  mkdirSync(taskDir, { recursive: true })
  writeFileSync(join(taskDir, "state.json"), JSON.stringify(state, null, 2))
  return state
}
