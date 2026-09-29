import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { hooksFromDir, loadManifest, resolvedLayout, runUnits, type Hooks, type Layout, type Manifest, type Unit } from "./hooks.ts"
import { writeReport, type Report } from "./report.ts"
import { readRows, readState, settleUnit, writeUnitsSnapshot } from "./state.ts"

export type ShepPort = {
  setLayout: (layout: Layout, taskDir: string) => void
  spawnWorker: (name: string, kind: string, briefPath: string, cwd: string) => boolean
  paneAlive: (name: string) => boolean
  reprompt: (name: string, briefPath: string) => boolean
  retire: (name: string) => void
  retireAll: () => void
  verify: () => string
  wake: (label: string, kind: string, detail: string) => void
  tailPane: (logPath: string) => boolean
}

export type Flight = {
  unit: Unit
  logPath: string
  briefPath: string
  lastSize: number
  lastChange: number
  spawnedAt: number
  reprompted: boolean
}

export type CycleDeps = {
  taskDir: string
  hooks: Hooks
  shep: ShepPort
  inFlight: Map<string, Flight>
  attempts: Map<string, number>
  slots?: number
  stallMs?: number
  briefGraceMs?: number
  now?: () => number
}

const DEFAULT_SLOTS = 2
const DEFAULT_STALL_MS = 10 * 60_000
const DEFAULT_BRIEF_GRACE_MS = 90_000
const DEFAULT_CHECK_MS = 10 * 60_000
const RETRY_CAP = 3
const SHEP_LABEL_MAX = 32

// Pane labels are scoped per run: two ad-hoc runs that generate the same
// unit ids must not collide in the shared shep ledger (2026-09-29
// incident: "label already tracks pane" failed three units).
export function paneLabeler(runId: string): (name: string) => string {
  const assigned = new Map<string, string>()
  return (name: string): string => {
    const memo = assigned.get(name)
    if (memo) return memo
    const budget = SHEP_LABEL_MAX - runId.length - 1
    let stem = name.slice(0, Math.max(1, budget)).replace(/[^a-z0-9_-]/g, "")
    if (!/^[a-z]/.test(stem)) stem = `w${stem}`
    let label = `${stem}-${runId}`
    let n = 2
    while (label.length > SHEP_LABEL_MAX || [...assigned.values()].includes(label)) {
      const suffix = String(n)
      stem = name.slice(0, Math.max(1, budget - suffix.length)).replace(/[^a-z0-9_-]/g, "")
      if (!/^[a-z]/.test(stem)) stem = `w${stem}`
      label = `${stem}${suffix}-${runId}`
      n++
    }
    assigned.set(name, label)
    return label
  }
}

export function runIdFor(seed: string): string {
  let hash = 0
  for (const ch of seed) {
    hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  }
  return `${Date.now().toString(36)}${hash.toString(36)}`.slice(0, 8)
}

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
  const briefGraceMs = deps.briefGraceMs ?? DEFAULT_BRIEF_GRACE_MS
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
    } else if (
      !existsSync(flight.logPath) &&
      !flight.reprompted &&
      now() - flight.spawnedAt > briefGraceMs
    ) {
      // The agent started but the brief never landed (a startup race shep
      // cannot see). Submit it once more; the stall timer is the backstop.
      flight.reprompted = true
      const ok = deps.shep.reprompt(`w-${id}`, flight.briefPath)
      if (ok) {
        flight.lastChange = now()
      }
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
        briefPath,
        lastSize: 0,
        lastChange: now(),
        spawnedAt: now(),
        reprompted: false,
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
  layout?: Layout
  slots?: number
  stallMs?: number
  briefGraceMs?: number
  checkMs?: number
  deadlineMs?: number
  now?: () => number
  log?: (msg: string) => void
}): Promise<Report> {
  const loaded = input.hooks
    ? { hooks: input.hooks, manifest: input.manifest }
    : hooksFromDir(input.taskDir)
  const manifest = loaded.manifest ?? loadManifest(input.taskDir)
  const where = manifest.report?.where ?? input.taskDir
  const layout = input.layout ?? resolvedLayout(manifest)
  const slots = input.slots ?? manifest.workflow.slots ?? DEFAULT_SLOTS
  const stallMs = input.stallMs ?? DEFAULT_STALL_MS
  const briefGraceMs = input.briefGraceMs ?? DEFAULT_BRIEF_GRACE_MS
  const checkMs = input.checkMs ?? DEFAULT_CHECK_MS
  const deadlineMs = input.deadlineMs ?? 2 * 60 * 60_000
  const now = input.now ?? Date.now
  const log = input.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`))
  const inFlight = new Map<string, Flight>()
  const attempts = new Map<string, number>()
  const started = now()

  log(`orchestrator: started (taskDir=${input.taskDir}, layout=${layout.tab}/${layout.orchestrator}, fallback check every ${checkMs}ms)`)

  input.shep.setLayout(layout, input.taskDir)
  const logsDir = join(input.taskDir, "logs")
  mkdirSync(logsDir, { recursive: true })

  let laneOpened = false
  const openLane = () => {
    if (laneOpened) return
    laneOpened = true
    const ok = input.shep.tailPane(join(input.taskDir, "orchestrator.log"))
    log(ok ? "orchestrator: lane pane tailing this log" : "orchestrator: no lane pane; read this log")
  }
  if (layout.orchestrator === "left") openLane()

  const timers = new Set<ReturnType<typeof setTimeout>>()
  const watchers: FSWatcher[] = []
  const watchedFiles = new Set<string>()
  let running = false
  let finished = false
  let firstCycle = true

  const cleanup = () => {
    for (const t of timers) clearTimeout(t)
    timers.clear()
    for (const w of watchers) w.close()
    watchers.length = 0
  }

  const run = (): void => {
    if (running || finished) return
    running = true
    try {
      const done = cycle({
        taskDir: input.taskDir,
        hooks: loaded.hooks,
        shep: input.shep,
        inFlight,
        attempts,
        slots,
        stallMs,
        briefGraceMs,
        now,
      })
      if (firstCycle) {
        firstCycle = false
        if (layout.orchestrator === "right") openLane()
      }
      if (done) {
        finished = true
        cleanup()
        return
      }
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
        finished = true
        cleanup()
        return
      }
      watchFlights()
      scheduleGrace()
    } finally {
      running = false
    }
  }

  const queueRun = (): void => {
    const t = setTimeout(() => {
      timers.delete(t)
      run()
    }, 150)
    timers.add(t)
  }

  const watchFlights = (): void => {
    for (const flight of inFlight.values()) {
      if (watchedFiles.has(flight.logPath)) continue
      watchedFiles.add(flight.logPath)
      try {
        watchers.push(watch(flight.logPath, () => queueRun()))
      } catch {
        // the file may not exist yet; the fallback check covers it
      }
    }
  }

  const scheduleGrace = (): void => {
    for (const flight of inFlight.values()) {
      if (existsSync(flight.logPath) || flight.reprompted) continue
      const wait = briefGraceMs - (now() - flight.spawnedAt) + 500
      const t = setTimeout(() => {
        timers.delete(t)
        run()
      }, Math.max(200, wait))
      timers.add(t)
    }
  }

  try {
    watchers.push(watch(logsDir, () => queueRun()))
  } catch {
    log("orchestrator: logs watch unavailable — fallback check only")
  }
  const fallback = setInterval(run, checkMs)
  run()

  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (finished) {
        clearInterval(poll)
        clearInterval(fallback)
        resolve()
      }
    }, 20)
  })

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
