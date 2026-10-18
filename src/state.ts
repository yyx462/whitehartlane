import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type Settled = { done: string[]; failed: string[] }

// The unit ledger — the task dir's ONE lifecycle store (OPTIMUM §4,
// state-store consolidation): append-only, one card per fact — the
// zen-2 law the OS disk already lives by (events.jsonl is the trace,
// job.json a projection). A card that carries `unit` SETTLES that
// unit: ok → done, FAILED/grade-fault → failed; `info` observes and
// never settles; the last settle card wins, so a regrade flips a unit
// by APPENDING, never by rewriting. regrade (and any future resume
// verb) finds the exact card that failed and re-enters THERE (#144).
//
// state.json is deleted as a store. It survives one release as a
// READ-ONLY spelling for pre-consolidation runs — their ledgers are
// half-populated (stalled/deadline/spawn-fail settles never carded),
// so for those dirs the file stays the truth and regrade still flips
// it (flipLegacyState). New runs never write it.
export type CheckpointStatus = "ok" | "FAILED" | "grade-fault" | "info"
export type Checkpoint = { ts: string; stage: string; status: CheckpointStatus; unit?: string; detail?: string }

export function checkpoint(
  taskDir: string,
  stage: string,
  status: CheckpointStatus,
  detail?: string,
  unit?: string,
): void {
  mkdirSync(taskDir, { recursive: true })
  const entry: Checkpoint = { ts: new Date().toISOString(), stage, status }
  if (unit) entry.unit = unit
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

// One settle, one card — the only settle verb. stage names the act
// (`unit:u1`, `grade:u1`, `gate:g1`, `wake:k1`…); the card IS the
// write; readState's fold is the only reader. No projection file is
// maintained on the side — that second store was the drift.
export function settle(
  taskDir: string,
  unit: string,
  stage: string,
  pass: boolean,
  detail?: string,
  fault = false,
): void {
  checkpoint(taskDir, stage, pass ? "ok" : fault ? "grade-fault" : "FAILED", detail, unit)
}

export function writeUnitsSnapshot(
  taskDir: string,
  units: { id: string; brief: string }[],
): void {
  mkdirSync(taskDir, { recursive: true })
  const body = units.map((unit) => JSON.stringify(unit)).join("\n")
  writeFileSync(join(taskDir, "units.jsonl"), `${body}\n`)
}

function readLegacyState(taskDir: string): Settled {
  try {
    const parsed = JSON.parse(readFileSync(join(taskDir, "state.json"), "utf8")) as Partial<Settled>
    return { done: parsed.done ?? [], failed: parsed.failed ?? [] }
  } catch {
    return { done: [], failed: [] }
  }
}

// settled = a pure fold of the ledger, in card order (the finish
// order the old file captured). A legacy state.json wins when present:
// it was written on EVERY settle path, its sibling ledger was not.
export function readState(taskDir: string): Settled {
  if (existsSync(join(taskDir, "state.json"))) return readLegacyState(taskDir)
  let done: string[] = []
  let failed: string[] = []
  for (const card of readCheckpoints(taskDir)) {
    if (!card.unit || card.status === "info") continue
    if (card.status === "ok") {
      failed = failed.filter((id) => id !== card.unit)
      if (!done.includes(card.unit)) done.push(card.unit)
    } else {
      done = done.filter((id) => id !== card.unit)
      if (!failed.includes(card.unit)) failed.push(card.unit)
    }
  }
  return { done, failed }
}

// The legacy flip — regrade only, and only for a pre-consolidation
// dir (state.json present). New dirs settle by appending a card.
export function flipLegacyState(taskDir: string, unitId: string, pass: boolean): void {
  if (!existsSync(join(taskDir, "state.json"))) return
  const state = readLegacyState(taskDir)
  if (pass) {
    state.failed = state.failed.filter((id) => id !== unitId)
    if (!state.done.includes(unitId)) state.done.push(unitId)
  } else if (!state.failed.includes(unitId)) {
    state.failed.push(unitId)
  }
  writeFileSync(join(taskDir, "state.json"), JSON.stringify(state, null, 2))
}
