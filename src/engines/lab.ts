// The lab engine (moved out of bin/lab-orchestrator so tests can reach
// it — the bin is only the door). A professor pane, then student panes.
// A lab program is a workflow.toml (kind = "lab") — the shape a lab
// STAGE mints as its child under stages/<id>/ (ADR 0014: the only lab
// there is; the spur step file no longer admits). The engine drives
// the Rail: births panes, grades, relays wave closes to the actor,
// answers permission dialogs, and writes the report.
//
// ADR 5 parity (the redesign): the experiment OUTLIVES the process.
// The engine's state is a fold over durable records, not process
// memory — the pane ledger's bookings say who was born (and which
// session each mind was), units/<id>/log.txt say who closed, and
// protocol.json says what the actor asked for. Entering, the engine
// re-joins that state instead of re-birthing blind: SIGTERM drains to
// quiescence and parks (null report — the door books the pause), and
// a continued lab resumes the actor's booked session (the one mind
// that IS the experiment) and re-inhabits in-flight mocks from their
// bookings. Fan-out and coworker have told this story since ADR 5;
// the lab is the third telling, same shape.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { withBackpressure } from "../core/backpressure.ts"
import { runCounts, runEndDetector, runGrade, runSignalDetector } from "../doors/hooks.ts"
import { emptyBoard } from "../core/lanes.ts"
import { endOf, readSignal, wakesFor, waveClosed } from "./live-run.ts"
import { gradeCall } from "../core/live-grade.ts"
import { actorBrief, paneName } from "../core/roles.ts"
import { writeReport, type Report } from "../core/report.ts"
import { drainDeadline } from "../adapters/levy.ts"
import { waitChange, type Rail, type RailLedger } from "../adapters/rail.ts"
import { closes } from "../core/verbose.ts"

const GRACE_MS = 15_000

type PaneRec = RailLedger["job"]["panes"][number]

// The entry fold: the pane ledger's LATEST booking per role, keyed by
// the raw pane names this engine births ("actor", "mock-<id>"). Latest
// wins; a booking without a session id still means "an earlier
// generation birthed this" (the double-birth guard) — it just has no
// conversation to resume, and the fresh brief is the fallback.
export type LabBookings = {
  actor?: { tool: string; session_id?: string }
  mocks: Map<string, { tool: string; session_id?: string }>
}

export function labBookings(ledger: RailLedger | null): LabBookings {
  const mocks = new Map<string, { tool: string; session_id?: string }>()
  let actor: LabBookings["actor"]
  const latest = new Map<string, PaneRec>()
  for (const p of ledger?.job.panes ?? []) {
    if (!p.unit || !p.transcript) continue
    const prev = latest.get(p.unit)
    if (!prev || p.born > prev.born) latest.set(p.unit, p)
  }
  for (const [unit, p] of latest) {
    const pointer = {
      tool: p.transcript.tool,
      ...(p.transcript.session_id ? { session_id: p.transcript.session_id } : {}),
    }
    if (unit === "actor") actor = pointer
    else if (unit.startsWith("mock-")) mocks.set(unit.slice("mock-".length), pointer)
  }
  return { actor, mocks }
}

// ONE flight record per mock, replacing the old born/mockPane pair:
// carried = born of an EARLIER generation, no pane in this process
// (its log markers still close it; nothing of it is running here).
// spawnWave re-inhabits carried mocks when the wave names them again.
type Flight = { spawnedAt: number; pane?: string; carried: boolean }

// ADR 0016 slice 2 — the LAB station hosting contract: a lab STAGE in
// a chain runs THIS engine in-process at stations/<S>/ (the stage's
// brief is the actor's, its detectors ride the spec; the station is a
// folder, never program bytes). The actor spawns on the same rail, so
// the model pin inherits the parent manifest exactly as the mint's
// child toml used to write.
export type LabStationSpec = {
  dir: string
  brief: string
  workerKind: string
  detectors?: { signal?: string; end?: string }
}

export async function runLab(
  rail: Rail,
  opts: { graceMs?: number; station?: LabStationSpec } = {},
): Promise<Report | null> {
  // the newborn/liveness grace (endOf's own dead-rule default; the
  // drain-dead carry uses the same clock) — parameterized so tests
  // drive it to 0
  const graceMs = opts.graceMs ?? GRACE_MS
  const taskDir = opts.station?.dir ?? rail.taskDir
  const log = rail.log
  let jobText = opts.station?.brief ?? ""
  if (!jobText) {
    try { jobText = readFileSync(join(taskDir, "actor.md"), "utf8") } catch {}
  }
  // Detectors: the program's say in what a wave or an end is. Absent,
  // the OS defaults (protocol.json, log.txt) run — a detector may
  // slow or fail, never kill the rail: refusal retries, deterministic
  // failure degrades and logs once. A hosted station carries its
  // detectors in the spec; a standalone run reads the manifest.
  const manifestEarly = (() => {
    try {
      return rail.manifest()
    } catch {
      return null
    }
  })()
  const detectors = opts.station?.detectors ?? manifestEarly?.detectors
  const saidDetectorFailure = new Set<string>()
  function detectorCall<T>(what: string, fn: () => T, fallback: T): T {
    try {
      return withBackpressure(fn, { who: what, log })
    } catch (err) {
      const line = `${what} failed: ${err && err instanceof Error ? err.message : String(err)}`
      if (!saidDetectorFailure.has(line)) {
        saidDetectorFailure.add(line)
        log(line)
      }
      return fallback
    }
  }
  let board = emptyBoard()
  if (rail.wantVerbose()) rail.openVerbose()
  mkdirSync(join(taskDir, "briefs"), { recursive: true })
  // No orchestrator pane: the only mind a lab needs is the actor's
  // (protocol.json is consumed). A blocked mock is a question for the
  // typed decider, and a deny-pattern block finished_by blocked — no
  // judgment seat with an unread output channel (decision.txt was
  // never consumed).
  const actorPath = join(taskDir, "briefs", "actor.md")
  writeFileSync(actorPath, actorBrief(jobText))
  // the entry fold (ADR 5): who an earlier generation birthed, and
  // which sessions they were. carried mocks have no pane here — the
  // wave re-inhabits them when protocol.json names them again.
  const bookings = labBookings(rail.ledger)
  const flights = new Map<string, Flight>()
  for (const [id, booking] of bookings.mocks) {
    flights.set(id, { spawnedAt: Date.now(), carried: true })
    if (booking.session_id) log(`continue: mock ${id} carries booked session ${booking.session_id}`)
  }
  const closed = new Set<string>()
  const graded = new Map<string, { pass: boolean; row: string }>()
  const woke: string[] = []
  let prompted = ""
  const kind = opts.station?.workerKind ?? (() => {
    try {
      return readFileSync(join(taskDir, "workflow.toml"), "utf8").match(/worker_kind\s*=\s*"([^"]+)"/)?.[1] ?? "opencode"
    } catch {
      return "opencode"
    }
  })()

  function mockEnd(id: string, spawnedAt: number) {
    const logPath = join(taskDir, "units", id, "log.txt")
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    return endOf(logText, id, rail.paneAlive(paneName("mock", id)), Date.now() - spawnedAt)
  }

  // the marker-only read: a carried mock has no pane in this process,
  // so liveness proves nothing — only its log speaks.
  function markerOf(id: string): string | null {
    const logPath = join(taskDir, "units", id, "log.txt")
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    return endOf(logText, id, true, 0)
  }

  function spawnWave(units: { id: string; brief: string }[]) {
    for (const unit of units) {
      const flight = flights.get(unit.id)
      if (flight && !flight.carried) continue // this process birthed it already
      const dir = join(taskDir, "units", unit.id)
      mkdirSync(dir, { recursive: true })
      const briefPath = join(dir, "brief.md")
      const name = paneName("mock", unit.id)
      writeFileSync(briefPath, [
        unit.brief,
        "",
        "When you finish, append exactly this line to the log file",
        `${join(dir, "log.txt")} :`,
        `done ${unit.id}`,
        "",
        "If you cannot proceed, append exactly this line and stop:",
        `blocked ${unit.id}: <why>`,
        "",
        `Write what you generated to ${join(dir, "result.md")}`,
      ].join("\n"))
      // an earlier generation already closed this unit (its log says
      // so) — no pane: the marker alone settles it
      if (markerOf(unit.id)) {
        flights.set(unit.id, { spawnedAt: Date.now(), carried: true })
        continue
      }
      // the scope's roots (task dir + program roots) pre-seed the mock's
      // sandbox — same projection the real panes get
      rail.writePermissions(dir)
      const slot = rail.ensureRole(board, "mock", dir)
      board = slot.board
      const resumeId = flight?.carried ? bookings.mocks.get(unit.id)?.session_id : undefined
      const ok = slot.pane
        ? rail.inhabitPane(name, kind, slot.pane, briefPath, dir, undefined, undefined, Boolean(resumeId), resumeId)
        : false
      if (slot.pane) rail.renamePane(slot.pane, name)
      flights.set(unit.id, { spawnedAt: Date.now(), pane: slot.pane, carried: false })
      if (ok) {
        if (resumeId) {
          // ADR 5: the parked generation's session continues — never a
          // re-brief; one rail nudge says the run is back
          rail.promptAgent(
            name,
            "[rail] The run was parked and has been continued. Your session resumed — finish the unit; when done, append the done line to your log exactly as your brief describes.",
          )
          log(`continue: mock ${name} resumed session ${resumeId}`)
        } else {
          rail.say("rail", `birth ${name}`)
        }
      }
      log(ok ? `name ${name} pane ${slot.pane}` : `mock ${name} failed to spawn`)
    }
  }

  function gradeUnit(id: string) {
    try {
      graded.set(id, runGrade(taskDir, rail.manifest(), { id, brief: "" }))
      rail.say("rail", `grade ${paneName("mock", id)}`)
    } catch (err) {
      graded.set(id, { pass: false, row: "fail grade" })
      log(`grade ${id} failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  function promptActor(ends: { id: string; end: string | null }[]) {
    rail.promptAgent("actor", [
      "Wave closed.",
      ...ends.map((row) => `${paneName("mock", row.id)}: ${row.end}`),
      "Results are under units/.",
      "Write the next protocol.json, or {\"stop\":true}.",
    ].join("\n"))
    log("prompted actor")
    rail.say("rail", "prompt actor")
  }

  function birthActor() {
    const actor = rail.ensureRole(board, "actor", taskDir)
    board = actor.board
    const resumeId = bookings.actor?.session_id
    const ok = actor.pane
      ? rail.inhabitPane("actor", "pi", actor.pane, actorPath, taskDir, undefined, undefined, Boolean(resumeId), resumeId)
      : false
    if (actor.pane) rail.renamePane(actor.pane, "actor")
    if (ok) {
      if (resumeId) {
        // the experiment's one mind continues its booked conversation:
        // every wave it composed and every result it read is in the
        // session — one nudge, never a re-brief
        rail.promptAgent(
          "actor",
          '[rail] The run was parked and has been continued. You are still the actor; pick up exactly where you left off. The wave\'s panes are back — write the next protocol.json, or {"stop":true} to finish.',
        )
        log(`continue: actor resumes booked session ${resumeId}`)
      }
      log(`name actor pane ${actor.pane}`)
      rail.say("rail", "birth actor")
    } else {
      log("actor pane failed")
    }
  }

  birthActor()

  // the drain (ADR 5, the door is kind-blind): SIGTERM asks the engine
  // for its boundary. Lab's boundary is quiescence — no mock in
  // flight, the actor not mid-turn — bounded by the ceiling. A dead
  // pane mid-drain stays OPEN (carried; its booked session resumes
  // next generation), exactly as fan-out's drain leaves its units.
  let draining = false
  let parked = false
  let drainUntil: number | null = null
  const dropOwnDrain = rail.installDrain(() => {
    if (draining || parked) return
    draining = true
    const ceiling =
      Number(process.env.AGENTIC_OS_DRAIN_MS ?? "") || manifestEarly?.workflow?.drain_timeout_ms || 10 * 60_000
    drainUntil = drainDeadline(taskDir, Date.now(), ceiling)
    log(`lab: pause requested — draining to quiescence (ceiling ${new Date(drainUntil).toISOString()})`)
  })
  // Station tenancy (ADR 0016): a hosted experiment sweeps exactly its
  // OWN panes on the way out — the actor plus every mock this
  // generation spawned (rail.retire is per-pane: no fleet tab, no
  // pkill of the run dir). A hosted lab never calls retireAll.
  const endOfExperimentSweep = (): void => {
    dropOwnDrain()
    if (opts.station) {
      for (const [id, flight] of flights) {
        if (flight.pane) rail.retire(paneName("mock", id))
      }
      rail.retire("actor")
      log(`lab: retired the actor + ${[...flights.values()].filter((f) => f.pane).length} mock pane(s) — the parent's rail is untouched`)
      return
    }
    rail.retireAll()
    rail.closeVerbose()
  }
  const deadline = Date.now() + 2 * 60 * 60_000
  while (Date.now() < deadline) {
    const signal = detectors?.signal
      ? detectorCall("signal detector", () => runSignalDetector(taskDir, manifestEarly), { kind: "missing" })
      : readSignal(taskDir)
    const ends = [...flights].map(([id, flight]) => {
      let end: string | null
      if (detectors?.end) {
        end = detectorCall(`end detector ${id}`, () => runEndDetector(taskDir, manifestEarly, id), null)
      } else if (flight.carried) {
        end = markerOf(id)
      } else if (draining && Date.now() - flight.spawnedAt > graceMs && !rail.paneAlive(paneName("mock", id))) {
        // draining: a dead mock is not a verdict — carry it open; the
        // booked session resumes next generation
        if (flight.pane) board = rail.dropPane(board, flight.pane)
        flight.carried = true
        log(`draining: mock ${id} pane died — carried open; its booked session resumes next generation`)
        end = null
      } else {
        end = mockEnd(id, flight.spawnedAt)
      }
      // liveness stays rail-owned: a dead pane is dead even under a
      // custom end detector, and herdr still names the blocked
      if (!end && !flight.carried && Date.now() - flight.spawnedAt > graceMs && !rail.paneAlive(paneName("mock", id))) {
        end = "dead"
      }
      if (!end && !flight.carried && rail.workerStatus(paneName("mock", id)) === "blocked") {
        end = "blocked"
      }
      return { id, end }
    })
    // Privilege (zen 6, rail-owned): the sweep answers every blocked
    // pane's dialog at the rail — this loop carries the consequence. A
    // capped block (a deny pattern) finished_by the mock blocked,
    // exactly as fan-out finished_by a capped unit; a non-dialog block
    // simply stands as blocked in the report. The id joins `woke` only
    // on a real cap, so a fresh dialog on the same pane is answered
    // again next beat. The sweep runs while DRAINING too (fan-out
    // parity: a dialog is the rail's business, never a boundary).
    const sweep = rail.tickPrivilege()
    for (const id of wakesFor(ends, woke)) {
      const name = paneName("mock", id)
      if (!sweep.capped.has(name)) {
        if (sweep.answered.has(name)) log(`answered permission for ${name}`)
        continue
      }
      woke.push(id)
      const pane = flights.get(id)?.pane
      closed.add(id)
      if (pane) {
        rail.closePane(pane)
        rail.retire(name)
        board = rail.dropPane(board, pane)
      }
      log(`mock ${name} hit the deny cap — finished blocked`)
      rail.say("watcher", `${name} deny cap`)
      rail.say("operator", `close ${name}`)
    }
    if (draining) {
      // the actor may have finished while the drain ran — a stop is a
      // terminal state, not a park: the report is the answer
      if (signal.kind === "stop") break
      // the boundary: no mock in flight (every pane-holding flight
      // closed; carried ones run nothing) and the actor not mid-turn
      const inFlight = ends.some((row) => row.end === null && !flights.get(row.id)?.carried)
      const actorWorking = rail.workerStatus("actor") === "working"
      if ((!inFlight && !actorWorking) || (drainUntil !== null && Date.now() > drainUntil)) {
        parked = true
        break
      }
      await waitChange(taskDir, 5_000)
      continue
    }
    if (signal.kind === "stop") break
    if (signal.kind === "wave") spawnWave(signal.wave.units)
    for (const row of ends) {
      if (gradeCall(row.end, graded.has(row.id))) gradeUnit(row.id)
      if (!closes(row.end) || closed.has(row.id)) continue
      const pane = flights.get(row.id)?.pane
      const name = paneName("mock", row.id)
      closed.add(row.id)
      if (pane) {
        rail.closePane(pane)
        rail.retire(name)
        board = rail.dropPane(board, pane)
      }
      rail.say("operator", `close ${name}`)
    }
    if (waveClosed(ends)) {
      const mark = ends.map((row) => row.end).join(",")
      if (prompted !== mark) {
        prompted = mark
        promptActor(ends)
      }
    }
    await waitChange(taskDir, 5_000)
  }
  // ADR 5: parked — not a finish. No report; the pane ledger carries
  // the bookings (the actor's and every in-flight mock's); a typed
  // continue resumes them. The door books the pause.
  if (parked) {
    endOfExperimentSweep()
    log("lab: parked — paused; the actor's and in-flight mocks' sessions stay booked — continue resumes them")
    return null
  }
  const finalEnds = [...flights].map(([id, flight]) => ({
    id,
    end: detectors?.end
      ? detectorCall(`end detector ${id}`, () => runEndDetector(taskDir, manifestEarly, id), null)
      : flight.carried
        ? markerOf(id)
        : mockEnd(id, flight.spawnedAt),
  }))
  const rows = finalEnds.map((row) => {
    const grade = graded.get(row.id)
    return { unit: row.id, result: grade?.row ?? row.end ?? "open", pass: grade ? grade.pass : row.end === "done" }
  })
  const stopped = readSignal(taskDir).kind === "stop"
  const report = writeReport(
    taskDir,
    taskDir,
    rows,
    (table) => runCounts(taskDir, rail.manifest(), table),
    stopped && rows.every((row) => row.pass) ? "done" : rows.length === 0 && stopped ? "done" : undefined,
  )
  endOfExperimentSweep()
  return report
}
