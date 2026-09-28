import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { hooksFromDir, runUnits, loadManifest, type Hooks, type Manifest, type Unit } from "./hooks.ts"
import { writeReport, type Report } from "./report.ts"
import { readRows, readState, settleUnit, writeUnitsSnapshot } from "./state.ts"

export type ShepPort = {
  spawnWorker: (name: string, kind: string, briefPath: string, cwd: string) => boolean
  paneAlive: (name: string) => boolean
  retire: (name: string) => void
  retireAll: () => void
  verify: () => string
  wake: (label: string, kind: string, detail: string) => void
  tailPane: (logPath: string) => boolean
}

export type Flight = {
  unit: Unit
  logPath: string
  lastSize: number
  lastChange: number
}

export type CycleDeps = {
  taskDir: string
  hooks: Hooks
  shep: ShepPort
  inFlight: Map<string, Flight>
  attempts: Map<string, number>
  slots?: number
  stallMs?: number
  now?: () => number
}

const DEFAULT_SLOTS = 3
const DEFAULT_STALL_MS = 10 * 60_000
const RETRY_CAP = 3

export function loadUnitsFor(taskDir: string, hooks: Hooks): Unit[] {
  const path = join(taskDir, "units.jsonl")
  if (!existsSync(path)) {
    writeUnitsSnapshot(taskDir, hooks.units())
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Unit)
}

export function briefFor(unit: Unit, taskDir: string): string {
  return [
    `Work dir: ${taskDir}`,
    "",
    unit.brief,
    "",
    "When you finish the work, append exactly this line to the log file",
    `${join(taskDir, "logs", `${unit.id}.log`)} :`,
    `done ${unit.id}`,
    "",
    "If you cannot proceed, append exactly this line to the same file and stop:",
    `blocked ${unit.id}: <one line saying why>`,
    "",
    "Do not write anything else to that log. Do not do any other work.",
  ].join("\n")
}

function logText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

export function cycle(deps: CycleDeps): boolean {
  const slots = deps.slots ?? DEFAULT_SLOTS
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS
  const now = deps.now ?? Date.now
  const units = loadUnitsFor(deps.taskDir, deps.hooks)
  mkdirSync(join(deps.taskDir, "briefs"), { recursive: true })
  mkdirSync(join(deps.taskDir, "logs"), { recursive: true })
  mkdirSync(join(deps.taskDir, "results"), { recursive: true })

  for (const [id, flight] of [...deps.inFlight]) {
    const size = existsSync(flight.logPath) ? readFileSync(flight.logPath).length : 0
    const text = logText(flight.logPath)
    if (text.includes(`done ${id}`)) {
      const grade = deps.hooks.grade(flight.unit)
      settleUnit(deps.taskDir, id, grade.pass, {
        unit: id,
        result: grade.row,
        pass: grade.pass,
      })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      if (!grade.pass) {
        deps.shep.wake(id, "blocked", `grade failed: ${grade.row}`)
      }
    } else if (text.includes(`blocked ${id}`)) {
      const why = text.split("\n").find((line) => line.includes(`blocked ${id}`)) ?? ""
      settleUnit(deps.taskDir, id, false, { unit: id, result: "blocked", pass: false })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      deps.shep.wake(id, "blocked", why)
    } else if (!deps.shep.paneAlive(`w-${id}`)) {
      settleUnit(deps.taskDir, id, false, { unit: id, result: "pane dead", pass: false })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      deps.shep.wake(id, "blocked", "pane not live in herdr")
    } else if (size === flight.lastSize && now() - flight.lastChange > stallMs) {
      settleUnit(deps.taskDir, id, false, { unit: id, result: "stalled", pass: false })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      deps.shep.wake(id, "blocked", `no log output for ${stallMs}ms`)
    } else if (size !== flight.lastSize) {
      flight.lastSize = size
      flight.lastChange = now()
    }
  }

  const settled = readState(deps.taskDir)
  const settledIds = new Set([...settled.done, ...settled.failed])
  const unsettled = units.filter(
    (unit) => !settledIds.has(unit.id) && !deps.inFlight.has(unit.id),
  )
  while (deps.inFlight.size < slots && unsettled.length > 0) {
    const unit = unsettled.shift()!
    const briefPath = join(deps.taskDir, "briefs", `${unit.id}.md`)
    writeFileSync(briefPath, briefFor(unit, deps.taskDir))
    const ok = deps.shep.spawnWorker(
      `w-${unit.id}`,
      deps.hooks.workerKind,
      briefPath,
      deps.taskDir,
    )
    if (ok) {
      deps.attempts.delete(unit.id)
      deps.inFlight.set(unit.id, {
        unit,
        logPath: join(deps.taskDir, "logs", `${unit.id}.log`),
        lastSize: 0,
        lastChange: now(),
      })
    } else {
      const attempts = (deps.attempts.get(unit.id) ?? 0) + 1
      deps.attempts.set(unit.id, attempts)
      if (attempts >= RETRY_CAP) {
        settleUnit(deps.taskDir, unit.id, false, {
          unit: unit.id,
          result: "spawn failed",
          pass: false,
        })
        deps.shep.wake(unit.id, "blocked", `spawn failed ${attempts} times`)
      }
    }
  }

  const finalState = readState(deps.taskDir)
  const finalSettled = new Set([...finalState.done, ...finalState.failed])
  return units.every((unit) => finalSettled.has(unit.id)) && deps.inFlight.size === 0
}

export async function runOrchestrator(input: {
  taskDir: string
  shep: ShepPort
  hooks?: Hooks
  manifest?: Manifest
  slots?: number
  stallMs?: number
  pollMs?: number
  deadlineMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}): Promise<Report> {
  const loaded = input.hooks
    ? { hooks: input.hooks, manifest: input.manifest }
    : hooksFromDir(input.taskDir)
  const manifest = loaded.manifest ?? loadManifest(input.taskDir)
  const where = manifest.report?.where ?? input.taskDir
  const pollMs = input.pollMs ?? 5_000
  const deadlineMs = input.deadlineMs ?? 2 * 60 * 60_000
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const log = input.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`))
  const inFlight = new Map<string, Flight>()
  const attempts = new Map<string, number>()
  const started = now()

  log(`orchestrator: started (taskDir=${input.taskDir})`)
  const tailOk = input.shep.tailPane(join(input.taskDir, "orchestrator.log"))
  log(tailOk ? "orchestrator: lane pane tailing this log" : "orchestrator: no lane pane; read this log")

  let done = false
  while (!done) {
    done = cycle({
      taskDir: input.taskDir,
      hooks: loaded.hooks,
      shep: input.shep,
      inFlight,
      attempts,
      slots: input.slots,
      stallMs: input.stallMs,
      now,
    })
    if (done) break
    if (now() - started > deadlineMs) {
      log("orchestrator: deadline passed; settling the rest failed")
      for (const [id, flight] of [...inFlight]) {
        settleUnit(input.taskDir, id, false, { unit: id, result: "deadline", pass: false })
        input.shep.retire(`w-${id}`)
        inFlight.delete(id)
      }
      const state = readState(input.taskDir)
      const units = loadUnitsFor(input.taskDir, loaded.hooks)
      for (const unit of units) {
        if (!state.done.includes(unit.id) && !state.failed.includes(unit.id)) {
          settleUnit(input.taskDir, unit.id, false, {
            unit: unit.id,
            result: "deadline",
            pass: false,
          })
        }
      }
      break
    }
    await sleep(pollMs)
  }

  const report = writeReport(input.taskDir, where, readRows(input.taskDir), loaded.hooks.counts)
  input.shep.retireAll()
  const receipt = input.shep.verify()
  log(`orchestrator: report ${report.status} at ${join(input.taskDir, "report.json")} — ${receipt}`)
  input.shep.wake(
    "fan-out",
    "done",
    `report: ${join(input.taskDir, "report.json")} (${report.status}) — ${receipt}`,
  )
  return report
}
