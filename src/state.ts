import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { appendEvent, createJob, findJobByDir, openSession, readEvents } from "./store.ts"

export type Settled = { done: string[]; failed: string[] }

// The unit ledger — ONE store, the OS-disk trace (OPTIMUM §4 + §8's
// fold): every card is a `unit.card` event on the task dir's owning
// session trace (store.ts events.jsonl — zen 2's law: the trace is
// the source, projections are derived). A card that carries `unit`
// SETTLES that unit: ok → done, FAILED/grade-fault → failed; `info`
// observes and never settles; the last settle card wins, so a regrade
// flips a unit by APPENDING, never by rewriting. regrade (and any
// future resume verb) finds the exact card that failed and re-enters
// THERE (#144).
//
// The task dir keeps only the delivery interface (briefs, units.jsonl,
// report, wake.json). It is NOT a store anymore: the task-dir
// checkpoints.jsonl — a second carded spelling that merely mirrored
// the trace — is retired (OPTIMUM §8, the events fold #162 named).
// Both legacy spellings survive one release as READ-ONLY inputs for
// pre-fold dirs: state.json still wins its own read wholesale (its
// sibling ledger was half-populated), and a checkpoints.jsonl that
// already exists folds BEFORE the trace cards (it is strictly older).
// New runs never write either.
export type CheckpointStatus = "ok" | "FAILED" | "grade-fault" | "info"
export type Checkpoint = { ts: string; stage: string; status: CheckpointStatus; unit?: string; detail?: string }

// The dir → trace join, ONE spelling, memoized per process. findJobByDir
// is deterministic (oldest job owning the dir), so every process — the
// orchestrator mid-run, a later regrade, a rerun's fresh booking —
// resolves the SAME trace, and a rerun's cards fold in beside the
// original run's exactly as they did when one file accumulated them.
//
// A jobless dir (the front door's in-process grading, fixtures) mints
// its record at the FIRST CARD, never on a read: a dir that settles
// units is a run, and runs leave records — jobless settles used to be
// invisible to the OS disk. The mint races only if two processes write
// a jobless dir's first cards concurrently; unreachable in production,
// where every booked run owns its job before the engine starts.
const traceCache = new Map<string, { sid: string; jid: string }>()

function traceOf(taskDir: string, mint: boolean): { sid: string; jid: string } | null {
  const hit = traceCache.get(taskDir)
  if (hit) return hit
  const job = findJobByDir(taskDir)
  if (job) {
    const found = { sid: job.sid, jid: job.id }
    traceCache.set(taskDir, found)
    return found
  }
  if (!mint) return null
  const sess = openSession({ cwd: taskDir })
  const job2 = createJob({
    sid: sess.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: basename(taskDir),
    dir: taskDir,
  })
  const minted = { sid: job2.sid, jid: job2.id }
  traceCache.set(taskDir, minted)
  return minted
}

export function checkpoint(
  taskDir: string,
  stage: string,
  status: CheckpointStatus,
  detail?: string,
  unit?: string,
): void {
  const trace = traceOf(taskDir, true)!
  appendEvent(trace.sid, {
    actor: "rail",
    kind: "unit.card",
    jid: trace.jid,
    dir: taskDir,
    stage,
    status,
    ...(unit ? { unit } : {}),
    ...(detail ? { detail } : {}),
  })
}

// Card order = the dir's ledger order: a pre-fold file's cards (it is
// strictly older than any trace card), then this dir's trace cards in
// append order. The dir filter — not the jid — is the key: the ledger
// belongs to the DIR (a rerun folds in beside the original run).
export function readCheckpoints(taskDir: string): Checkpoint[] {
  const cards: Checkpoint[] = []
  const legacy = join(taskDir, "checkpoints.jsonl")
  if (existsSync(legacy)) {
    for (const line of readFileSync(legacy, "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        cards.push(JSON.parse(line) as Checkpoint)
      } catch {
        cards.push({ ts: "", stage: "unparsable", status: "info", detail: line.slice(0, 80) })
      }
    }
  }
  const trace = traceOf(taskDir, false)
  if (trace) {
    for (const e of readEvents(trace.sid)) {
      if (e.kind !== "unit.card" || e.dir !== taskDir) continue
      cards.push({
        ts: e.ts,
        stage: String(e.stage),
        status: e.status as CheckpointStatus,
        ...(e.unit !== undefined ? { unit: String(e.unit) } : {}),
        ...(e.detail !== undefined ? { detail: String(e.detail) } : {}),
      })
    }
  }
  return cards
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
