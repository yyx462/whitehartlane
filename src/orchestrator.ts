import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { withBackpressure } from "./backpressure.ts"
import { hooksFromDir, loadManifest, resolvedLayout, runUnits, type Hooks, type Layout, type Manifest, type Unit } from "./hooks.ts"
import { writeReport, type Report, type ReportRow } from "./report.ts"
import { readState, settleUnit, writeUnitsSnapshot } from "./state.ts"

export type ShepPort = {
  setLayout: (layout: Layout, taskDir: string) => void
  spawnWorker: (name: string, kind: string, briefPath: string, cwd: string) => boolean
  // Resume a parked unit (ADR 5): same pane lifecycle as spawnWorker,
  // but the host session continues from the booked pointer and the
  // brief is the continue brief. Absent or failing, the caller falls
  // back to spawnWorker with the continue brief (outliving memory:
  // the unit dir tells a fresh worker everything).
  resumeWorker?: (
    name: string,
    session: ResumePointer,
    briefPath: string,
    cwd: string,
  ) => boolean
  paneAlive: (name: string) => boolean
  reprompt: (name: string, briefPath: string) => boolean
  retire: (name: string) => void
  retireAll: () => void
  verify: () => string
  wake: (label: string, kind: string, detail: string) => void
  tailPane: (logPath: string) => boolean
  // Blocks until the pane is done, blocked, or the timeout hits.
  // Absent in tests: file growth and the deadline timer are enough.
  waitWorker?: (name: string, timeoutMs: number) => Promise<"woke" | "miss">
}

// The booked pointer a continued pane resumes from (ADR 5).
export type ResumePointer = { tool: string; session_id?: string; cwd: string }

// Each worker owns one directory: units/<unit>/{brief.md, log.txt,
// result.md}. It is the worker's cwd, its artifact home, and the key
// that makes its host-tool transcript resolvable.
export function unitDir(taskDir: string, unitId: string): string {
  return join(taskDir, "units", unitId)
}

export function unitPaths(taskDir: string, unitId: string): { dir: string; briefPath: string; logPath: string; resultPath: string } {
  const dir = unitDir(taskDir, unitId)
  return { dir, briefPath: join(dir, "brief.md"), logPath: join(dir, "log.txt"), resultPath: join(dir, "result.md") }
}

export type CanaryState = { enabled: boolean; released: boolean; failed: boolean }

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
  emit?: (kind: string, payload: Record<string, unknown>) => void
  worktree?: string
  canary?: CanaryState
  // Pause drain (ADR 5): while draining, no new panes are claimed and a
  // dead or stalled pane does not settle — the drain ceiling decides,
  // and the unit stays open for a resumed session.
  draining?: boolean
  // Units parked mid-flight on an earlier generation, keyed by unit id:
  // respawn them with the booked session pointer instead of a fresh brief.
  resumes?: Map<string, ResumePointer>
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

// The units hook runs once per run, before any pane exists. A provider
// refusal (RefusedError, exit 75 from the hook) is retried by the rail
// with backoff — visible line per wait, trace event, hard cap. A
// deterministic failure fails fast. Idempotent by construction: the
// units file only lands after the hook succeeds.
export function acquireUnits(
  taskDir: string,
  hooks: Hooks,
  opts: { log?: (msg: string) => void; emit?: (kind: string, payload: Record<string, unknown>) => void } = {},
): Unit[] {
  return withBackpressure(() => loadUnitsFor(taskDir, hooks), {
    who: "planner",
    log: opts.log,
    emit: opts.emit,
  })
}

export function briefFor(unit: Unit, taskDir: string, worktree?: string): string {
  const paths = unitPaths(taskDir, unit.id)
  const where = worktree
    ? [
        `Project dir: ${worktree} (this is your cwd — edit the project here)`,
        `Write your deliverable to ${paths.resultPath}`,
      ]
    : [
        `Work dir: ${paths.dir} (this is your cwd — write result.md here)`,
        "",
        `Write your deliverable to ${paths.resultPath} unless the brief above says otherwise.`,
      ]
  return [
    ...where,
    "",
    unit.brief,
    "",
    "When you finish the work, append exactly this line to the log file",
    `${paths.logPath} :`,
    `done ${unit.id}`,
    "",
    "If you cannot proceed, append exactly this line to the same file and stop:",
    `blocked ${unit.id}: <one line saying why>`,
    "",
    "Do not write anything else to that log. Do not do any other work.",
  ].join("\n")
}

// The brief a reborn pane receives (ADR 5): the session (when it could
// be resumed) already knows the work; the unit dir is the outliving
// memory a session-less takeover reads instead.
export function continueBriefFor(
  unit: Unit,
  session: ResumePointer,
  paths: { dir: string; briefPath: string; logPath: string },
): string {
  return [
    `You are continuing unit ${unit.id} — the run was parked mid-unit and has been continued.`,
    session.session_id
      ? "Your previous session was resumed: pick up exactly where you left off."
      : "Your predecessor's session could not be resumed: read the unit dir (log.txt, result.md, brief.md) and take the work over.",
    "",
    `Unit dir: ${paths.dir}`,
    `Working directory: ${session.cwd}`,
    `The original brief, if you need it: ${paths.briefPath}`,
    "",
    "When you finish the work, append exactly this line to the log file",
    `${paths.logPath} :`,
    `done ${unit.id}`,
    "",
    "If you cannot proceed, append exactly this line to the same file and stop:",
    `blocked ${unit.id}: <one line saying why>`,
    "",
    "Do not write anything else to that log. Do not do any other work.",
  ].join("\n")
}

// The drain ceiling (ADR 5): `pause --wait` writes a one-shot deadline
// into the Job dir — read and cleared at the first drain. Anything
// missing or unparsable falls back to now + the configured ceiling.
export function drainDeadline(taskDir: string, nowMs: number, ceilingMs: number): number {
  const path = join(taskDir, "drain.deadline")
  try {
    const at = Date.parse(readFileSync(path, "utf8").trim())
    rmSync(path, { force: true })
    if (Number.isFinite(at)) return at
  } catch {
    // no override file — the configured ceiling applies
  }
  return nowMs + ceilingMs
}

function logText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

// Respawn a parked unit (ADR 5): the continue brief goes to the resumed
// session when the port can resume, else to a fresh worker — the brief
// covers both (the session knows; the unit dir tells a takeover all).
function resumeSpawn(
  deps: CycleDeps,
  unit: Unit,
  resume: ResumePointer,
  paths: { dir: string; briefPath: string; logPath: string },
): boolean {
  const continuePath = join(paths.dir, "continue.md")
  writeFileSync(continuePath, continueBriefFor(unit, resume, paths))
  const cwd = deps.worktree ?? resume.cwd ?? paths.dir
  if (deps.shep.resumeWorker) {
    return deps.shep.resumeWorker(`w-${unit.id}`, resume, continuePath, cwd)
  }
  return deps.shep.spawnWorker(`w-${unit.id}`, deps.hooks.workerKind, continuePath, cwd)
}

export function cycle(deps: CycleDeps): boolean {
  const slots = deps.slots ?? DEFAULT_SLOTS
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS
  const briefGraceMs = deps.briefGraceMs ?? DEFAULT_BRIEF_GRACE_MS
  const now = deps.now ?? Date.now
  const units = loadUnitsFor(deps.taskDir, deps.hooks)

  // Every settle flows through here: state.json (resume projection) plus
  // the unit.settled event — the grade row's one and only home.
  const settle = (id: string, pass: boolean, row: ReportRow): void => {
    settleUnit(deps.taskDir, id, pass, row)
    deps.emit?.("unit.settled", { unit: id, pass, result: row.result })
    if (deps.canary?.enabled && !deps.canary.released && !deps.canary.failed) {
      if (pass) deps.canary.released = true
      else deps.canary.failed = true
    }
  }

  for (const [id, flight] of [...deps.inFlight]) {
    const size = existsSync(flight.logPath) ? readFileSync(flight.logPath).length : 0
    const text = logText(flight.logPath)
    if (text.includes(`done ${id}`)) {
      if (deps.canary?.enabled && !deps.canary.released) {
        writeFileSync(join(unitDir(deps.taskDir, id), ".grade-jev"), "")
      }
      const grade = deps.hooks.grade(flight.unit)
      settle(id, grade.pass, { unit: id, result: grade.row, pass: grade.pass })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      if (!grade.pass) {
        deps.shep.wake(id, "blocked", `grade failed: ${grade.row}`)
      }
    } else if (text.includes(`blocked ${id}`)) {
      const why = text.split("\n").find((line) => line.includes(`blocked ${id}`)) ?? ""
      settle(id, false, { unit: id, result: "blocked", pass: false })
      deps.shep.retire(`w-${id}`)
      deps.inFlight.delete(id)
      deps.attempts.delete(id)
      deps.shep.wake(id, "blocked", why)
    } else if (!deps.shep.paneAlive(`w-${id}`)) {
      if (deps.draining) {
        // draining: leave the unit open — continue resumes its session
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        deps.attempts.delete(id)
      } else {
        settle(id, false, { unit: id, result: "pane dead", pass: false })
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        deps.attempts.delete(id)
        deps.shep.wake(id, "blocked", "pane not live in herdr")
      }
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
        deps.emit?.("reprompt", { unit: id, reason: "brief grace" })
      }
    } else if (!deps.draining && size === flight.lastSize && now() - flight.lastChange > stallMs) {
      settle(id, false, { unit: id, result: "stalled", pass: false })
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
  const cap = deps.canary?.enabled && !deps.canary.released ? 1 : slots
  if (!deps.canary?.failed) {
    while (!deps.draining && deps.inFlight.size < cap && unsettled.length > 0) {
      const unit = unsettled.shift()!
      const paths = unitPaths(deps.taskDir, unit.id)
      mkdirSync(paths.dir, { recursive: true })
      writeFileSync(paths.briefPath, briefFor(unit, deps.taskDir, deps.worktree))
      const resume = deps.resumes?.get(unit.id)
      const ok = resume
        ? resumeSpawn(deps, unit, resume, paths)
        : deps.shep.spawnWorker(
            `w-${unit.id}`,
            deps.hooks.workerKind,
            paths.briefPath,
            deps.worktree ?? paths.dir,
          )
      if (ok) {
      deps.attempts.delete(unit.id)
      deps.inFlight.set(unit.id, {
        unit,
        logPath: paths.logPath,
        briefPath: paths.briefPath,
        lastSize: 0,
        lastChange: now(),
        spawnedAt: now(),
        reprompted: false,
      })
    } else {
      const attempts = (deps.attempts.get(unit.id) ?? 0) + 1
      deps.attempts.set(unit.id, attempts)
      if (attempts >= RETRY_CAP) {
        settle(unit.id, false, {
          unit: unit.id,
          result: "spawn failed",
          pass: false,
        })
        deps.shep.wake(unit.id, "blocked", `spawn failed ${attempts} times`)
      }
    }
    }
  }

  const finalState = readState(deps.taskDir)
  const finalSettled = new Set([...finalState.done, ...finalState.failed])
  if (deps.canary?.failed && deps.inFlight.size === 0) return true
  return units.every((unit) => finalSettled.has(unit.id)) && deps.inFlight.size === 0
}

// Runs the fan-out rail. Resolves with the Report on finish, or null
// when the run parked (SIGTERM drained to its boundary — ADR 5): no
// report is written, the caller books the pause.
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
  emit?: (kind: string, payload: Record<string, unknown>) => void
  existingRows?: ReportRow[]
  worktree?: string
  canary?: boolean
  // Pause drain (ADR 5): the drain ceiling defaults to the manifest's
  // drain_timeout_ms, then the stall timeout. SIGTERM starts the drain
  // unless trapSignals is false (tests drive the loop another way).
  drainMs?: number
  trapSignals?: boolean
  resumes?: Map<string, ResumePointer>
}): Promise<Report | null> {
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
  // Rows accumulate here across cycles (the events carry each settle;
  // existingRows covers a resumed orchestrator's earlier work).
  const rows: ReportRow[] = [...(input.existingRows ?? [])]
  const emit = input.emit ?? (() => {})
  const canary: CanaryState = { enabled: input.canary === true, released: false, failed: false }

  log(`orchestrator: started (taskDir=${input.taskDir}, layout=${layout.tab}/${layout.orchestrator}, idle until a queue message)`)

  input.shep.setLayout(layout, input.taskDir)
  const unitsDir = join(input.taskDir, "units")
  mkdirSync(unitsDir, { recursive: true })
  acquireUnits(input.taskDir, loaded.hooks, {
    log,
    emit: (kind, payload) => emit(kind, payload),
  })

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
  let parked = false
  let draining = false
  let drainUntil: number | null = null
  const drainMs = input.drainMs ?? manifest.workflow.drain_timeout_ms ?? stallMs
  let firstCycle = true
  let fallback: ReturnType<typeof setInterval> | null = null

  const cleanup = () => {
    for (const t of timers) clearTimeout(t)
    timers.clear()
    if (fallback) clearInterval(fallback)
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
        worktree: input.worktree,
        canary,
        draining,
        resumes: input.resumes,
        emit: (kind, payload) => {
          emit(kind, payload)
          if (kind === "unit.settled" && typeof payload.unit === "string") {
            rows.push({
              unit: payload.unit,
              result: String(payload.result ?? ""),
              pass: payload.pass === true,
            })
          }
        },
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
      if (draining) {
        if (inFlight.size === 0) {
          log("orchestrator: drained — parking paused")
          parked = true
          finished = true
          cleanup()
          return
        }
        if (drainUntil !== null && now() > drainUntil) {
          log("orchestrator: drain ceiling passed — retiring in-flight panes unsettled (sessions stay booked)")
          for (const [id] of [...inFlight]) {
            input.shep.retire(`w-${id}`)
            inFlight.delete(id)
          }
          parked = true
          finished = true
          cleanup()
          return
        }
      }
      if (now() - started > deadlineMs) {
        log("orchestrator: deadline passed; settling the rest failed")
        for (const [id, flight] of [...inFlight]) {
          settleUnit(input.taskDir, id, false, { unit: id, result: "deadline", pass: false })
          emit("unit.settled", { unit: id, pass: false, result: "deadline" })
          rows.push({ unit: id, result: "deadline", pass: false })
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
            emit("unit.settled", { unit: unit.id, pass: false, result: "deadline" })
            rows.push({ unit: unit.id, result: "deadline", pass: false })
          }
        }
        finished = true
        cleanup()
        return
      }
      watchFlights()
    } finally {
      running = false
    }
  }

  let queued = false
  let pending = false
  let lastWhy = "start"
  let wake: (() => void) | null = null
  let idled = false
  let armed: ReturnType<typeof setTimeout> | null = null
  const waited = new Set<string>()

  const enqueue = (why: string): void => {
    if (finished) return
    lastWhy = why
    if (pending) return
    pending = true
    const t = setTimeout(() => {
      timers.delete(t)
      pending = false
      queued = true
      wake?.()
    }, 150)
    timers.add(t)
  }

  // SIGTERM is the drain (ADR 5): stop claiming, let in-flight units
  // settle, then park. SIGINT stays an immediate stop (the bin books
  // the abort); SIGKILL cannot be caught and is the abort verb's own.
  const requestPause = (): void => {
    if (finished || draining) return
    draining = true
    drainUntil = drainDeadline(input.taskDir, now(), drainMs)
    log(`orchestrator: pause requested — draining (ceiling ${new Date(drainUntil).toISOString()})`)
    enqueue("pause")
  }
  if (input.trapSignals !== false) {
    process.on("SIGTERM", requestPause)
  }

  const watchFlights = (): void => {
    for (const flight of inFlight.values()) {
      if (watchedFiles.has(flight.logPath)) continue
      watchedFiles.add(flight.logPath)
      try {
        watchers.push(watch(flight.logPath, () => enqueue("log")))
      } catch {
        // the file may not exist yet; the deadline timer covers it
      }
    }
  }

  const kickIfReady = (): void => {
    for (const flight of inFlight.values()) {
      if (!existsSync(flight.logPath)) continue
      if (readFileSync(flight.logPath).length > flight.lastSize) {
        enqueue("log")
        return
      }
    }
  }

  const arm = (): void => {
    if (armed) {
      clearTimeout(armed)
      timers.delete(armed)
      armed = null
    }
    const waits = [deadlineMs - (now() - started)]
    if (draining && drainUntil !== null) waits.push(drainUntil - now())
    for (const flight of inFlight.values()) {
      if (!existsSync(flight.logPath) && !flight.reprompted) {
        waits.push(flight.spawnedAt + briefGraceMs - now())
      }
      waits.push(flight.lastChange + stallMs - now())
    }
    const ms = Math.max(1, Math.min(...waits))
    armed = setTimeout(() => {
      if (armed) timers.delete(armed)
      armed = null
      enqueue("timer")
    }, ms)
    timers.add(armed)
  }

  const watchPane = (id: string): void => {
    if (!input.shep.waitWorker || waited.has(id)) return
    waited.add(id)
    void input.shep.waitWorker(`w-${id}`, stallMs).then((status) => {
      if (status !== "woke") return
      waited.delete(id)
      if (inFlight.has(id)) enqueue("pane")
    })
  }

  try {
    watchers.push(watch(unitsDir, () => enqueue("units")))
  } catch {
    log("orchestrator: units watch unavailable — timer wakes only")
    fallback = setInterval(() => enqueue("timer"), checkMs)
  }
  run()
  while (!finished) {
    kickIfReady()
    for (const id of inFlight.keys()) watchPane(id)
    if (queued) {
      queued = false
      run()
      continue
    }
    arm()
    if (!idled) {
      log("orchestrator: idle, waiting for a queue message")
      idled = true
    }
    await new Promise<void>((resolve) => {
      wake = () => {
        wake = null
        resolve()
      }
    })
    queued = false
    log(`orchestrator: woke (${lastWhy})`)
    run()
  }

  if (parked) {
    input.shep.retireAll()
    log("orchestrator: parked — paused; a typed continue resumes the unfinished units from booked sessions")
    return null
  }
  const report = writeReport(
    input.taskDir,
    where,
    rows,
    loaded.hooks.counts,
    canary.failed ? "canary-stopped" : undefined,
  )
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
