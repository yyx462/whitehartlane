import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, watch, writeFileSync, type FSWatcher } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { withBackpressure } from "../core/backpressure.ts"
import { chainOf, stepRecorder, type Chain } from "../core/orchestrator-chain.ts"
import { HookError, hooksFromDir, loadManifest, resolvedLayout, setHookRunNote, unitsFromStages, stepsFromStages, gradePlanFromStages, modelPlanFromStages, settingsPlanFromStages, type Hooks, type Layout, type Manifest, type Step, type GradePlan, type Unit } from "../doors/hooks.ts"
import { readModelsFile } from "../jev/model-ladder.ts"
import { runFaultLane, type FaultRail } from "./fault-lane.ts"
import { runCoworker } from "./coworker-run.ts"
import { runLab } from "./lab.ts"
import type { Member } from "./coworker.ts"
import { PERMISSION_CAP } from "../core/permission.ts"
import {
  drainDeadline,
} from "../adapters/levy.ts"
import { writeReport, type Report, type ReportRow } from "../core/report.ts"
import { findJobByDir } from "../adapters/store.ts"
import { checkpoint, readState, settle, writeUnitsSnapshot } from "../core/state.ts"

import type { AgentStatus } from "../ports/agent-host.ts"
export type { AgentStatus }

export type ShepPort = {
  setLayout: (layout: Layout, taskDir: string) => void
  spawnWorker: (name: string, kind: string, briefPath: string, cwd: string, model?: string, temperature?: number) => boolean
  // Issue #123 — renew the job lease once per engine cycle (one write).
  // Optional: a test shep without a ledger simply does not renew.
  renew?: () => void
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
    model?: string,
    temperature?: number,
  ) => boolean
  paneAlive: (name: string) => boolean
  // completion-detection: the pane's full verdict, once per beat — the
  // ONE liveness verb (j-964391's witness, promoted from stall
  // acquittal to completion trigger and sole spelling). "idle" means
  // the turn ended ("done" folds there); "unknown" = the pane speaks
  // no status grammar and the unit rides the fallback ladder. Absent
  // = unknown (old ports, byte-identical).
  workerStatus?: (name: string) => AgentStatus
  reprompt: (name: string, briefPath: string) => boolean
  retire: (name: string) => void
  retireAll: () => void
  verify: () => string
  wake: (label: string, kind: string, detail: string) => void
  // Blocks until the pane is done, blocked, or the timeout hits.
  // Absent in tests: file growth and the deadline timer are enough.
  waitWorker?: (name: string, timeoutMs: number) => Promise<"woke" | "miss">
  // The drain registration (ADR 5): the rail owns the SIGTERM trap
  // (the door is kind-blind), so an engine that can drain hands its
  // requestPause to the port. A port without the seam (tests) makes
  // runOrchestrator trap SIGTERM itself.
  installDrain?: (fn: () => void) => void
  // Privilege (zen 6, rail-owned): one sweep per cycle answers every
  // blocked pane's dialog at the rail — engines carry only the
  // consequence. answered = a dialog was answered (allow or deny — the
  // injected verdict is progress); capped = the deny cap hit (the
  // caller finished_by the unit like a block. Allows are free).
  tickPrivilege: () => { answered: Set<string>; capped: Set<string> }
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
  worktree: string
  // completion-detection (status-first lane): evidence reprompts sent
  // at idle with a missing deliverable (capped), and whether the pane
  // has been seen working since the last attempt — an idle pane that
  // never worked is the brief-grace lane's customer, not ours.
  settleAttempts: number
  workedSinceAttempt: boolean
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
  /** the birth judge's patience (default 3 min; workflow.born_ms) */
  bornMs?: number
  now?: () => number
  emit?: (kind: string, payload: Record<string, unknown>) => void
  worktree?: string
  // j-3520f7: a worker grinding silently (log quiet, files moving) must
  // not read as stalled — worktree churn is a heartbeat. Injectable so
  // the fake clock in tests never touches real mtimes.
  churnSince?: (worktree: string, sinceMs: number) => boolean
  // #165 / j-214576: a failed spawn below the retry cap must not wait out
  // the stall ladder — with nothing in flight the next wake can be
  // ~stallMs away, so 3 tries spanned 101 minutes. The runner arms a
  // short retry wake through this seam; tests spy on it.
  onSpawnRetry?: (unitId: string, attempts: number) => void
  canary?: CanaryState
  // Pause drain (ADR 5): while draining, no new panes are claimed and a
  // dead or stalled pane does not finish — the drain ceiling decides,
  // and the unit stays open for a resumed session.
  draining?: boolean
  // Units parked mid-flight on an earlier generation, keyed by unit id:
  // respawn them with the booked session pointer instead of a fresh brief.
  resumes?: Map<string, ResumePointer>
  // Booked wait (ADR 0006): true while a live child spur names this
  // unit's pane session as its spawner — the stall clock stands down.
  bookedWait?: (unitId: string) => boolean
  // completion-detection: "status-first" arms the platform pen — an
  // idle pane with a present deliverable settles with no marker (the
  // iter-4 lesson). Absent = "marker" = byte-identical to the
  // worker-pen protocol.
  settleMode?: "marker" | "status-first"
  // The passive stall ladder (log-quiet + tree-frozen + unbooked →
  // stalled). false suppresses the stalled verdict entirely — for the
  // status-first trial window, so the old killer cannot murder a
  // working agent mid-verdict. Absent = ladder on (the fallback).
  fallbackLadder?: boolean
  // ADR 0007: the manifest's finish-typed steps, when declared. Drives
  // wave gating and the done condition (check steps must finish too).
  // The chain object (src/orchestrator-chain.ts) — declared once here,
  // asked by cycle's spawn gate and the done condition alike.
  chain?: Chain
  // Issue #152/#150: per-unit grade binding compiled from [[stage]].
  // Absent (no stages) = every unit takes the task-level grade —
  // byte-identical to the pre-stage rail.
  stagePlan?: Map<string, GradePlan>
  // Per-mind model pins (unit.model → stage.model → manifest):
  // absent = undefined passed to the spawn seam, which falls to the
  // manifest pin — byte-identical to the pre-stage rail.
  unitModels?: Map<string, string>
  unitTemperatures?: Map<string, number>
  // The provider-fault lane's rail seam (j-93d652 gap #4): fan-out
  // workers get the jev ladder coworker members always had. Optional —
  // a test shep without it simply runs lane-less, as before.
  faults?: {
    sessionOf: (unitId: string) => string | undefined
    rebook?: (unitId: string) => string | undefined
    cwdOf: (unitId: string) => string
  } & FaultRail
}

const DEFAULT_SLOTS = 2
// the birth judge's patience: how long an unboarded pane may sit
// before it is judged dead at birth (j-4a0009: 3 dead-at-births rode
// the full 30-min stall ceiling). Default 3 min; workflow.born_ms
// tunes it (30s..10min).
const DEFAULT_BORN_MS = 180_000
const DEFAULT_STALL_MS = 10 * 60_000
const DEFAULT_BRIEF_GRACE_MS = 90_000
// Grace recheck cadence once the window has passed but the pane is
// working (the heartbeat defers the reprompt): cheap periodic looks, not
// a tight loop.
const GRACE_RECHECK_MS = 30_000
const DEFAULT_CHECK_MS = 10 * 60_000
// j-ba18b7: fs.watch (FSEvents) dropped a worker's done-append and the
// rail sat blind until a 10-minute stall timer fired on an already-done
// unit. While any flight is live, a cheap stat sweep of the unit logs
// backstops the file watchers — the ends live in the files, so the
// files are polled, not trusted.
const LOG_POLL_MS = 5_000
// ADR 0007: a check step polls — a gate that has not passed is re-asked
// at most this often (the arm'd sleep never exceeds it while gates
// pend, so an unpassed gate cannot dead-sleep the rail)
const DEFAULT_GATE_CHECK_MS = 30_000
const RETRY_CAP = 3
// #165: spawn retries ride THIS, not the stall ladder
const SPAWN_RETRY_MS = 30_000
// completion-detection: evidence reprompts at idle with a missing
// deliverable — hard cap so a wrong protocol check costs 8 bounded
// reprompts and one honest human verdict, never an infinite loop
// (the Claude Code #55754 lesson).
const SETTLE_ATTEMPT_CAP = 8
const SHEP_LABEL_MAX = 32

// Worktree churn as a stall heartbeat (j-3520f7): a worker whose log is
// quiet but whose tree is moving is working, not stalled. The check runs
// ONLY at the kill decision (one bounded find per candidate death).
// .git and node_modules are pruned: 430MB of packages can eat the whole
// timeout before the probe reaches src/ (j-443a63 — churn present, probe
// timed out, worker killed at 80% twice). find is absolute (a detached
// orchestrator's PATH is not guaranteed). A dead probe DEFERS — killing
// a live worker is the worse failure; the next window retries.
export function worktreeChurnedSince(worktree: string, sinceMs: number): boolean {
  if (!existsSync(worktree)) return false
  const ref = join(tmpdir(), `whitehartlane-churn-${process.pid}`)
  try {
    writeFileSync(ref, "")
    utimesSync(ref, new Date(sinceMs), new Date(sinceMs))
    const out = spawnSync(
      "/usr/bin/find",
      [
        worktree,
        "(", "-name", ".git", "-o", "-name", "node_modules", ")",
        "-prune", "-o",
        "-newer", ref,
        "-print", "-quit",
      ],
      { timeout: 15_000, encoding: "utf8" },
    )
    if ((out.stdout ?? "").trim().length > 0) return true
    // no hit within the window — a healthy probe's honest answer, or a
    // broken one (ENOENT, timeout mid-traverse). Only trust the "quiet"
    // verdict when find actually ran to completion.
    return out.status !== 0 || out.error ? true : false
  } catch {
    return true // a failed probe must never kill a live worker
  } finally {
    try {
      rmSync(ref, { force: true })
    } catch {}
  }
}

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

export function briefFor(unit: Unit, taskDir: string, worktree?: string, settleMode?: "marker" | "status-first"): string {
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
  // status-first: completion is the platform's pen — the rail settles
  // on the deliverable itself, so the closing contract asks for the
  // artifact and a plain stop. The blocked escape hatch stays in BOTH
  // modes: it is the worker's other pen, and it is cheap.
  const closing =
    settleMode === "status-first"
      ? [
          "When you finish the work, simply stop — the rail settles this unit on",
          `your deliverable at ${paths.resultPath} (the file must exist and be non-empty).`,
          "",
          "If you cannot proceed, append exactly this line to the log file",
          `${paths.logPath} :`,
          `blocked ${unit.id}: <one line saying why>`,
          "",
          "Do not write anything else to that log. Do not do any other work.",
        ]
      : [
          "When you finish the work, append exactly this line to the log file",
          `${paths.logPath} :`,
          `done ${unit.id}`,
          "",
          "If you cannot proceed, append exactly this line to the same file and stop:",
          `blocked ${unit.id}: <one line saying why>`,
          "",
          "Do not write anything else to that log. Do not do any other work.",
        ]
  return [...where, "", unit.brief, "", ...closing].join("\n")
}

// The protocol probe (completion-detection): does the deliverable the
// brief promised exist, with shape? SHAPE ONLY — semantics belong to
// the stage gate; this must never judge quality (a wrong check must
// cost 8 bounded reprompts, never a wrong verdict).
export function probeDeliverable(taskDir: string, unitId: string): { ok: boolean; detail: string } {
  const p = unitPaths(taskDir, unitId).resultPath
  if (!existsSync(p)) return { ok: false, detail: `deliverable missing: ${p}` }
  const size = readFileSync(p).length
  if (size === 0) return { ok: false, detail: `deliverable empty: ${p}` }
  return { ok: true, detail: `deliverable present: ${p} (${size}B)` }
}

// The evidence reprompt (not a plea): quotes the failing check and
// names the required artifact, so the agent can resolve the tension
// between its brief and the grade in one turn.
function evidenceBrief(unitId: string, why: string, resultPath: string): string {
  return [
    `Your unit ${unitId} stopped without its deliverable.`,
    "",
    `The check said: ${why}`,
    "",
    `Write your deliverable to ${resultPath} (non-empty), then simply stop.`,
    "Do not write anything to the log file — the rail settles on the deliverable itself.",
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
  // a resumed unit keeps its pin (the nearest declaration at mint time)
  const model = deps.unitModels?.get(unit.id)
  const temperature = deps.unitTemperatures?.get(unit.id)
  if (deps.shep.resumeWorker) {
    return deps.shep.resumeWorker(`w-${unit.id}`, resume, continuePath, cwd, model, temperature)
  }
  return deps.shep.spawnWorker(`w-${unit.id}`, deps.hooks.workerKind, continuePath, cwd, model, temperature)
}

// ── the flight bench (OPTIMUM §2, the flight half of the dispatch) ──
//
// Before: one interleaved rung ladder inside cycle() — marker,
// liveness, privilege, brief-grace, the #178 platform pen, the stall
// ladder — where every rung was guarded by every other rung's flags
// (settleMode, fallbackLadder, draining), and the close ceremony
// (settle card + retire + leave the maps + wake) was hand-rolled at
// eleven sites. Now, the same shape the step machines took in #167
// (one walker, kind-specific executors): ONE observation per flight
// per beat, an ORDERED bench of judges where the first ruling wins,
// and ONE bailiff applying the ruling. The mode flags stop guarding
// rungs and COMPOSE THE BENCH — the pen judge sits only in a
// status-first court, the stall judge leaves when fallback_ladder is
// switched off or a drain owns the run.
//
// The bench is the rail's, not this engine's: the protocol below
// (Ruling, Judge, holdCourt) is the shared law, and the coworker
// engine seats its own court on it (src/engines/coworker-run.ts — the
// second customer of #181, which folded that engine's hand-rolled
// nudge ladder and bespoke dead-record close onto this bench).

// One beat: everything a judge may ask about one flight, gathered
// once, in the open. waited/booked are LAZY (getters) — the wait-DAG
// reads bookings off disk, and only the judges that need them pay.
export type Beat = {
  id: string
  flight: Flight
  marker: "done" | "blocked" | null
  blockedWhy: string
  alive: boolean
  paneStatus: AgentStatus
  privilege: "capped" | "answered" | "none"
  size: number
  logPresent: boolean
  logGrew: boolean
  silentFor: number
  age: number
  waited: boolean
  booked: boolean
}

// What a judge returns. "close" = the flight ends (card + retire +
// wake, the one ceremony); "carry" = leave the unit open (a drain
// keeps it for its booked session); "defer" = the silence is
// explained, the clock resets; "reprompt" = an act, sent through the
// bailiff so the clock/event side-ceremonies have one spelling;
// "none" = no opinion, the next judge speaks.
export type Ruling =
  | {
      kind: "close"
      stage: string
      pass: boolean
      row: ReportRow
      faultsCanary?: boolean
      fault?: boolean
      detail?: string
      trigger?: string
      wake?: string
    }
  | { kind: "carry" }
  | {
      // dead at birth (j-4a0009, r8's j-3f4065): the pane lives but
      // the agent never boarded — no session after bornMs and one
      // re-resolve. Kill the empty pane, count the attempt, arm the
      // #165 respawn; the unit re-claims with a fresh pane
      kind: "rebirth"
      event?: [string, Record<string, unknown>]
    }
  | { kind: "defer"; why: string; event?: [string, Record<string, unknown>] }
  | {
      kind: "reprompt"
      note: string
      // "ok" = the clock resets and the event fires only when the port
      // accepted the prompt (brief grace); absent = always (the pen's
      // evidence reprompt books the attempt before it is sent)
      onOkOnly?: boolean
      event?: [string, Record<string, unknown>]
    }
  | { kind: "none" }

export type JudgeSeat = "marker" | "liveness" | "privilege" | "grace" | "birth" | "pen" | "stall"
// Generic over the beat: every court observes its own subject (the
// fan-out Beat above, the coworker MemberBeat one engine over) — the
// protocol (a typed beat, ordered judges, one bailiff) is what is
// shared, never the observation's shape.
export type Judge<B = Beat> = (beat: B) => Ruling

// The seating — composed once per cycle from the declared mode. This
// IS the precedence: marker beats liveness beats privilege beats
// grace beats birth; the pen (armed only by settle_mode =
// "status-first") hears idle panes before the stall ladder can; the
// stall judge is unseated by fallback_ladder = false (the ADR 0015
// trial window) and by every drain. Pure: tests pin the seating
// without building a run.
export function benchOrder(mode: {
  settleMode?: "marker" | "status-first"
  fallbackLadder?: boolean
  draining?: boolean
  faults?: boolean
}): JudgeSeat[] {
  const seats: JudgeSeat[] = ["marker", "liveness", "privilege", "grace"]
  // the birth judge needs session visibility (deps.faults) — without
  // it, it cannot tell boarded from never-born and stays seated out;
  // the stall ladder remains the backstop
  if (mode.faults) seats.push("birth")
  if (mode.settleMode === "status-first") seats.push("pen")
  if (mode.fallbackLadder !== false && !mode.draining) seats.push("stall")
  return seats
}

// The bench's ONE algorithm, shared by every court that seats it:
// judges in precedence order, the FIRST ruling wins. Each engine keeps
// its own loop and its own bailiff — the walk is the law, never the
// ceremony's body. Pure given the bench.
export function firstRuling<B>(bench: Judge<B>[], beat: B): Ruling {
  let ruling: Ruling = { kind: "none" }
  for (const judge of bench) {
    ruling = judge(beat)
    if (ruling.kind !== "none") return ruling
  }
  return ruling
}

// Per-run fault-lane state, keyed by the stable shep object (cycle
// rebuilds its deps literal per tick; the shep — the rail — is one
// object for the run's life).
const faultStateMap = new WeakMap<
  object,
  { awaitingTurn: Set<string>; actedFault: Map<string, string>; deadModels: Map<string, Set<string>>; overrides: Map<string, string> }
>()
// the getter the fault lane always called — written as a function from
// the start, declared as a WeakMap from the start, and the mismatch
// was masked because input.faults was never forwarded (dead code
// cannot crash; the birth judge's tests unmasked both)
function faultStateOf(shep: object) {
  let st = faultStateMap.get(shep)
  if (st === undefined) {
    st = { awaitingTurn: new Set(), actedFault: new Map(), deadModels: new Map(), overrides: new Map() }
    faultStateMap.set(shep, st)
  }
  return st
}

// Per-run check-reprompt memory, keyed by the stable shep object (the
// settle path re-runs per tick; the shep — the rail — is one object
// for the run's life). One revise round per unit, never more.
const checkRetriedOfMap = new WeakMap<object, Set<string>>()
// Per-run REBIRTH count, keyed the same way. NOT deps.attempts — the
// claim path deletes that map's rows on every SUCCESSFUL respawn, so
// a rebirth counter riding it would reset every generation (the
// dead-at-birth pane "successfully" spawns each time; only the agent
// never boards). Single writer: the rebirth ruling.
const rebirthCountMap = new WeakMap<object, Map<string, number>>()
function rebirthCountOf(shep: object): Map<string, number> {
  let m = rebirthCountMap.get(shep)
  if (m === undefined) {
    m = new Map()
    rebirthCountMap.set(shep, m)
  }
  return m
}function checkRetriedOf(shep: object): Set<string> {
  let s = checkRetriedOfMap.get(shep)
  if (s === undefined) {
    s = new Set()
    checkRetriedOfMap.set(shep, s)
  }
  return s
}

export function cycle(deps: CycleDeps): boolean {
  const slots = deps.slots ?? DEFAULT_SLOTS
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS
  const briefGraceMs = deps.briefGraceMs ?? DEFAULT_BRIEF_GRACE_MS
  const bornMs = deps.bornMs ?? DEFAULT_BORN_MS
  const now = deps.now ?? Date.now
  // one sweep per cycle: every blocked pane the rail holds gets its
  // dialog answered at the rail (queued notes ride the sweep) —
  // j-2b508e's worker never learned why it was denied; now no pane
  // waits on an engine's list to be swept
  const sweep = deps.shep.tickPrivilege()
  const units = loadUnitsFor(deps.taskDir, deps.hooks)

  // Every unit's finish flows through here: ONE ledger card (the
  // settle — the unit ledger is the task dir's only lifecycle store,
  // OPTIMUM §4) plus the unit.finished event. A grade-FAULT (infra,
  // not answer) never trips the canary: the stop-the-line gate exists
  // to protect slots from a doomed PLAN, and a broken hook says
  // nothing about the plan (#144).
  const finish = (
    id: string,
    pass: boolean,
    row: ReportRow,
    stage: string,
    faultsCanary = true,
    fault = false,
    detail?: string,
    trigger?: string,
  ): void => {
    settle(deps.taskDir, id, `${stage}:${id}`, pass, detail ?? row.result, fault, trigger)
    deps.emit?.("unit.finished", { unit: id, pass, result: row.result })
    if (faultsCanary && deps.canary?.enabled && !deps.canary.released && !deps.canary.failed) {
      if (pass) deps.canary.released = true
      else deps.canary.failed = true
    }
  }

  // observe: one Beat per flight per beat — the whole bench asks this,
  // never the shep/fs directly. workerStatus is asked ONCE (a working
  // pane is progress evidence the pen keys on). waited/booked stay
  // lazy: the wait-DAG reads bookings off disk, and only the judges
  // that need them pay for the read.
  const observe = (id: string, flight: Flight, swept: { answered: Set<string>; capped: Set<string> }): Beat => {
    const size = existsSync(flight.logPath) ? readFileSync(flight.logPath).length : 0
    const text = logText(flight.logPath)
    const paneStatus = deps.shep.workerStatus?.(`w-${id}`) ?? "unknown"
    if (paneStatus === "working") flight.workedSinceAttempt = true
    return {
      id,
      flight,
      marker: text.includes(`done ${id}`) ? "done" : text.includes(`blocked ${id}`) ? "blocked" : null,
      blockedWhy: text.split("\n").find((line) => line.includes(`blocked ${id}`)) ?? "",
      alive: deps.shep.paneAlive(`w-${id}`),
      paneStatus,
      privilege: swept.capped.has(`w-${id}`) ? "capped" : swept.answered.has(`w-${id}`) ? "answered" : "none",
      size,
      logPresent: existsSync(flight.logPath),
      logGrew: size !== flight.lastSize,
      silentFor: now() - flight.lastChange,
      age: now() - flight.spawnedAt,
      get waited() {
        // ADR 0016 slice 4: in-process stations ended the child-wait
        // stand-down — a booked delegation's wait returns with the
        // delegations/ commissioning if it is ever authored again
        return Boolean(deps.bookedWait?.(id))
      },
      get booked() {
        return Boolean(deps.bookedWait?.(id))
      },
    }
  }

  // ── the bench: each judge rules on one question; the first ruling
  // wins. Seats are added in benchOrder's precedence. ───────────────

  // The worker's own pen — the typed log markers (done/blocked), the
  // stage binding (#150), and the task grade.
  const markerJudge: Judge = (b) => {
    const id = b.id
    if (b.marker === "done") {
      checkpoint(deps.taskDir, `unit:${id}`, "info", "worker output landed", id)
      // Stage binding (#150): a stage may claim this unit's verdict for
      // itself — its own check, or its own word — instead of the task
      // verifier. Only "task"-bound units ever invoke [hooks] grade.
      const plan = deps.stagePlan?.get(id)
      if (plan && plan.grade !== "task") {
        if (plan.grade === "check") {
          let pass = false
          let why = ""
          try {
            // WHL_UNIT: the check names its subject — a per-unit hook
            // (the review rail's findings-check is the first customer)
            // must know WHICH unit it judges; without it the hook can
            // only scan every unit dir and guess the addressee.
            execSync(plan.check!, { cwd: deps.taskDir, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, WHL_UNIT: id } })
            pass = true
          } catch (err) {
            why = err instanceof Error ? err.message.split("\n")[0] : String(err)
          }
          if (pass) {
            return {
              kind: "close",
              stage: "check",
              pass,
              row: { unit: id, result: "stage check passed", pass },
            }
          }
          // #198 — audit before retire, the fan-out twin: ONE revise
          // round while the worker's pane still lives — the check's
          // verbatim why goes back to the producer; the next settle
          // re-runs the check; a second failure closes as before.
          const retried = checkRetriedOf(deps.shep)
          if (!retried.has(id)) {
            retried.add(id)
            return {
              kind: "reprompt",
              note: `[rail] your stage check failed: ${why.slice(0, 160)} — fix exactly what it names, then finish again`,
              onOkOnly: false,
              event: ["check-reprompt", { unit: id, why: why.slice(0, 120) }] as [string, Record<string, unknown>],
            }
          }
          return {
            kind: "close",
            stage: "check",
            pass,
            row: {
              unit: id,
              result: `stage check failed (after one revise round): ${why.slice(0, 120)}`,
              pass,
            },
            wake: `stage check failed: ${why.slice(0, 120)}`,
          }
        }
        // "none": the stage declared no hook — the worker's done is the
        // unit's word; grading belongs to a later stage's gate
        checkpoint(deps.taskDir, `check:${id}`, "info", "no check declared")
        return {
          kind: "close",
          stage: "unit",
          pass: true,
          row: { unit: id, result: "stage complete (no check declared)", pass: true },
        }
      }
      if (deps.canary?.enabled && !deps.canary.released) {
        writeFileSync(join(unitDir(deps.taskDir, id), ".grade-jev"), "")
      }
      // A grade that throws (timeout, dead hook) fails THIS unit —
      // never the run. j-5701b2: a 300s verifier timeout surfaced as a
      // raw ETIMEDOUT and aborted a whole pass one second before the
      // verifier passed. The row says grade error; the wake carries it;
      // the siblings keep their chance. A throw is always infra: it
      // cannot trip the canary and it lands on the stage ledger as a
      // grade-fault card `regrade` can re-enter.
      let grade: { pass: boolean; row: string; fault?: "grade-fault" }
      try {
        grade = deps.hooks.grade(b.flight.unit)
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        return {
          kind: "close",
          stage: "grade",
          pass: false,
          row: { unit: id, result: `grade error: ${why.split("\n")[0]}`, pass: false },
          faultsCanary: false,
          fault: true,
          wake: `grade error: ${why.split("\n")[0]}`,
        }
      }
      return {
        kind: "close",
        stage: "grade",
        pass: grade.pass,
        row: { unit: id, result: grade.row, pass: grade.pass },
        faultsCanary: !grade.fault,
        fault: Boolean(grade.fault),
        wake: grade.pass ? undefined : `grade failed: ${grade.row}`,
      }
    }
    if (b.marker === "blocked") {
      return {
        kind: "close",
        stage: "unit",
        pass: false,
        row: { unit: id, result: "blocked", pass: false },
        detail: b.blockedWhy.slice(0, 120),
        wake: b.blockedWhy,
      }
    }
    return { kind: "none" }
  }

  // A dead pane is dead regardless of everything else on the bench —
  // unless a drain owns the run, in which case the unit stays open for
  // its booked session.
  const livenessJudge: Judge = (b) => {
    if (b.alive) return { kind: "none" }
    if (deps.draining) return { kind: "carry" }
    return {
      kind: "close",
      stage: "unit",
      pass: false,
      row: { unit: b.id, result: "pane dead", pass: false },
      detail: "pane not live in herdr",
      wake: "pane not live in herdr",
    }
  }

  // Privilege (zen 6): a permission dialog is not a stall. The sweep
  // (rail-owned) already ran; this judge carries the consequence — a
  // capped pane finished_by like a block, an answered one just reset
  // the clock (an injected verdict is progress).
  const privilegeJudge: Judge = (b) => {
    if (b.privilege === "capped") {
      return {
        kind: "close",
        stage: "unit",
        pass: false,
        row: { unit: b.id, result: "blocked", pass: false },
        wake: `permission deny cap (${PERMISSION_CAP}) hit`,
      }
    }
    if (b.privilege === "answered") {
      return { kind: "defer", why: "an injected verdict is progress" }
    }
    return { kind: "none" }
  }

  // Brief grace: the agent started but the brief never landed (a
  // startup race shep cannot see). Submit it once more; the stall
  // timer is the backstop. A MISSING log alone is not evidence: the
  // worker protocol writes nothing to the log until its single done
  // line, so every healthy unit past the grace window used to be
  // re-briefed mid-work (j-78ca43: 3 of 4 units grace-reprompted at
  // exactly 90s). The heartbeat is the discriminator — a working agent
  // proves its brief landed, so the reprompt waits for a quiet pane.
  // status-first: an idle pane with no log is the PEN's customer — its
  // evidence reprompt carries the probe; a bare re-brief says nothing
  // the agent can act on.
  const graceJudge: Judge = (b) => {
    if (b.logPresent || b.flight.reprompted) return { kind: "none" }
    if (b.age <= briefGraceMs || b.paneStatus === "working") return { kind: "none" }
    if (deps.settleMode === "status-first" && b.paneStatus === "idle") return { kind: "none" }
    b.flight.reprompted = true
    return {
      kind: "reprompt",
      note: b.flight.briefPath,
      onOkOnly: true,
      event: ["reprompt", { unit: b.id, reason: "brief grace" }],
    }
  }

  // completion-detection — the platform pen (ADR 0015), seated only in
  // a status-first court. The turn ended and no marker came (the
  // iter-4 lesson: finished-but-silent used to ride the stall clock
  // into a wrong verdict). Ask the DAG first, then the deliverable;
  // the Clerk writes completion — the agent's memory is never
  // load-bearing. A pane idle since its first attempt without working
  // since belongs to the grace lane, not this one.
  const penJudge: Judge = (b) => {
    if (b.paneStatus !== "idle") return { kind: "none" }
    if (b.flight.settleAttempts !== 0 && !b.flight.workedSinceAttempt) return { kind: "none" }
    if (b.waited) return { kind: "defer", why: "waiting by design — a live child owns this silence" }
    const probe = probeDeliverable(deps.taskDir, b.id)
    deps.emit?.("unit.grade", {
      unit: b.id,
      status: probe.ok ? "ok" : "fail",
      detail: probe.detail,
      trigger: "idle",
    })
    if (probe.ok) {
      return {
        kind: "close",
        stage: "settle",
        pass: true,
        row: { unit: b.id, result: "settled on idle+grade", pass: true },
        detail: "platform pen: deliverable present, marker never seen",
        trigger: "idle+grade",
      }
    }
    b.flight.settleAttempts += 1
    b.flight.workedSinceAttempt = false
    if (b.flight.settleAttempts > SETTLE_ATTEMPT_CAP) {
      return {
        kind: "close",
        stage: "settle",
        pass: false,
        row: { unit: b.id, result: "stalled", pass: false },
        detail: `deliverable missing after ${SETTLE_ATTEMPT_CAP} evidence reprompts — ${probe.detail}`,
        trigger: "idle+grade",
        wake: `deliverable missing after ${SETTLE_ATTEMPT_CAP} evidence reprompts: ${probe.detail}`,
      }
    }
    // the evidence reprompt (never a plea — Claude Code #55754's bill):
    // quotes the failing check and names the artifact
    const note = join(unitDir(deps.taskDir, b.id), `reprompt-${b.flight.settleAttempts}.md`)
    writeFileSync(note, evidenceBrief(b.id, probe.detail, unitPaths(deps.taskDir, b.id).resultPath))
    return {
      kind: "reprompt",
      note,
      event: [
        "reprompt",
        { unit: b.id, reason: "idle grade fail", attempt: b.flight.settleAttempts, evidence: probe.detail },
      ],
    }
  }

  // The passive stall ladder — the fallback lane (status-blind panes
  // and the marker default), stood down by the trial switch and by
  // every drain. Quiet log AND quiet tree AND unbooked AND not
  // working: the only honest verdict left is stalled.
  const stallJudge: Judge = (b) => {
    if (deps.draining || deps.fallbackLadder === false) return { kind: "none" }
    if (b.logGrew || b.silentFor <= stallMs) return { kind: "none" }
    if (b.booked) {
      // booked wait: a live child spur holds this pane (ADR 0006) —
      // the silence is explained, so the stall clock restarts
      return { kind: "defer", why: "booked wait — a live child holds this pane" }
    }
    if (deps.churnSince?.(b.flight.worktree, b.flight.lastChange)) {
      // worktree churn while the log is quiet is still life — the
      // worker is editing, just not talking. The clock restarts; the
      // next silent window (quiet log AND quiet tree) re-arms.
      return { kind: "defer", why: "worktree churn", event: ["stall-deferred", { unit: b.id, reason: "worktree churn" }] }
    }
    if (b.paneStatus === "working") {
      // j-964391: mid-generation or a long bash call — quiet log,
      // quiet tree, live agent. The pane's own status is the word.
      return { kind: "defer", why: "agent working", event: ["stall-deferred", { unit: b.id, reason: "agent working" }] }
    }
    return {
      kind: "close",
      stage: "unit",
      pass: false,
      row: { unit: b.id, result: "stalled", pass: false },
      detail: `no log output for ${stallMs}ms`,
      wake: `no log output for ${stallMs}ms`,
    }
  }

  // The birth judge (j-4a0009, the third dead-at-birth): a pane that
  // never boarded — NO SESSION, not a quiet one (r6's momentum sat
  // log-silent 22 min and finished; it HAD a session). Session
  // existence is the only key; log quietness is NOT evidence. After
  // bornMs (+ one re-resolve — bookSessionLate only looked at +5s),
  // an unboarded pane is transport class: kill it, respawn it, cap
  // it. Grace's reprompt already had its chance (it seats first).
  const birthJudge: Judge = (b) => {
    if (!deps.faults || deps.draining) return { kind: "none" }
    if (b.marker !== null) return { kind: "none" }
    // 'working' exempts a pane only INSIDE the birth window (gate-r11
    // tests-1): a transport that reports working forever — the #249
    // auth-chrome class, where agent_status lies — must not give a
    // never-boarding pane a lifetime exemption from BOTH this judge
    // and the stall ladder's defer. After born_ms, session existence
    // is the only key (the judge's own r6 doctrine): boarded-quiet
    // panes spare via sessionOf above/below; unboarded ones rebirth.
    if (b.paneStatus === "working" && b.age <= bornMs) return { kind: "none" } // boarding right now
    if (deps.faults.sessionOf(b.id)) return { kind: "none" } // boarded — however quiet (r6)
    if (b.age <= bornMs) return { kind: "none" }
    const sid = deps.faults.rebook?.(b.id) // one last look, then judge
    if (sid) return { kind: "none" }
    // the cap reads the REBIRTH count (spawn-fail attempts reset on
    // every successful respawn — this pane spawns fine, it just never
    // boards); the ruling writes it, this judge only reads
    const rebirths = rebirthCountOf(deps.shep).get(b.id) ?? 0
    if (rebirths + 1 >= RETRY_CAP) {
      return {
        kind: "close",
        stage: "unit",
        pass: false,
        row: { unit: b.id, result: "dead at birth", pass: false },
        detail: `no agent session ${bornMs}ms after spawn, ${rebirths + 1} attempts`,
        wake: "dead at birth — the pane never boarded (issue #249 class)",
      }
    }
    return {
      kind: "rebirth",
      event: ["unit.reborn", { unit: b.id, rebirth: rebirths + 1, after_ms: bornMs }],
    }
  }

  const judges: Record<JudgeSeat, Judge> = {
    marker: markerJudge,
    liveness: livenessJudge,
    privilege: privilegeJudge,
    grace: graceJudge,
    birth: birthJudge,
    pen: penJudge,
    stall: stallJudge,
  }
  const bench: Judge[] = benchOrder(deps).map((seat) => judges[seat])

  // the bailiff: ONE ceremony per ruling. The close ceremony — settle
  // card, retire, leave the flight and attempts maps, wake — that
  // every rung of the old ladder hand-rolled lives here, once.
  const applyRuling = (beat: Beat, ruling: Ruling): void => {
    const { id, flight } = beat
    switch (ruling.kind) {
      case "close":
        finish(
          id,
          ruling.pass,
          ruling.row,
          ruling.stage,
          ruling.faultsCanary ?? true,
          ruling.fault ?? false,
          ruling.detail,
          ruling.trigger,
        )
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        deps.attempts.delete(id)
        if (ruling.wake !== undefined) deps.shep.wake(id, "blocked", ruling.wake)
        return
      case "carry":
        // a drain: the pane is gone, the unit stays open — continue
        // resumes its booked session
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        deps.attempts.delete(id)
        return
      case "rebirth": {
        // dead at birth: retire the empty pane, count the REBIRTH (the
        // map above — deps.attempts resets on successful respawn),
        // arm the near-term respawn — the unit re-claims next wake
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        const count = rebirthCountOf(deps.shep)
        count.set(id, (count.get(id) ?? 0) + 1)
        if (ruling.event) deps.emit?.(ruling.event[0], ruling.event[1])
        deps.onSpawnRetry?.(id, count.get(id) ?? 1)
        return
      }
      case "defer":
        flight.lastChange = now()
        if (ruling.event) deps.emit?.(ruling.event[0], ruling.event[1])
        return
      case "reprompt": {
        const ok = deps.shep.reprompt(`w-${id}`, ruling.note)
        if (ok || !ruling.onOkOnly) {
          flight.lastChange = now()
          if (ruling.event) deps.emit?.(ruling.event[0], ruling.event[1])
        }
        return
      }
      case "none":
        // no judge ruled — the only event left is growth: a log that
        // grew books its size and restarts the clock
        if (beat.logGrew) {
          flight.lastSize = beat.size
          flight.lastChange = now()
        }
    }
  }

  // the provider-fault lane (j-93d652 gap #4): fan-out workers ride the
  // jev model ladder — same algorithm as the conversation engine, one
  // shared extraction. Runs BEFORE the bench: a fault is transport
  // class and outranks stall, and its close flows through the same
  // ceremony applyRuling owns. State is keyed by the stable shep
  // object (cycle rebuilds its deps literal per tick; the shep — the
  // rail — is one object for the run's life).
  const faultLane = () => {
    if (!deps.faults) return
    const st = faultStateOf(deps.shep)
    let toml = ""
    try {
      toml = readFileSync(join(deps.taskDir, "workflow.toml"), "utf8")
    } catch {
      return
    }
    runFaultLane({
      taskDir: deps.taskDir,
      names: [...deps.inFlight.keys()],
      sessionOf: (id) => deps.faults!.sessionOf(id),
      cwdOf: (id) => deps.faults!.cwdOf(id),
      modelOf: (id) => st!.overrides.get(id) ?? deps.unitModels?.get(id),
      setModel: (id, model) => st!.overrides.set(id, model),
      isDead: (id) => !deps.inFlight.has(id),
      awaitingTurn: st.awaitingTurn,
      actedFault: st.actedFault,
      deadModels: st.deadModels,
      policy: readModelsFile(deps.taskDir, toml, join(import.meta.dirname, "..", "..")),
      rail: deps.faults,
      close: (id, why) => {
        finish(id, false, { unit: id, result: why, pass: false }, "unit", true, true)
        deps.shep.retire(`w-${id}`)
        deps.inFlight.delete(id)
        deps.attempts.delete(id)
      },
      resetClock: (id) => {
        const f = deps.inFlight.get(id)
        if (f) f.lastChange = now()
      },
      log: (msg) => deps.emit?.("fault-lane", { msg }),
      emit: (kind, payload) => deps.emit?.(kind, payload),
    })
  }
  faultLane()

  for (const [id, flight] of [...deps.inFlight]) {
    const beat = observe(id, flight, sweep)
    applyRuling(beat, firstRuling(bench, beat))
  }

  const finished = readState(deps.taskDir)
  const finishedIds = new Set([...finished.done, ...finished.failed])
  let unfinished = units.filter(
    (unit) => !finishedIds.has(unit.id) && !deps.inFlight.has(unit.id),
  )
  // ADR 0007 — waves gate spawning. A wave opens when every step of
  // every EARLIER wave finished done; a failed earlier step blocks the
  // downstream end-steps, which finish as blocked rows so the report
  // never lies by omission. The chain owns the walk — cycle only asks.
  if (deps.chain && deps.chain.steps.length > 0) {
    const failedIds = new Set(finished.failed)
    const spawnable: typeof unfinished = []
    for (const unit of unfinished) {
      const gate = deps.chain.gateOf(unit.id, finishedIds, failedIds)
      if (gate.open) spawnable.push(unit)
      else if (gate.blockedBy) {
        finish(unit.id, false, {
          unit: unit.id,
          result: `wave blocked by failed ${gate.blockedBy}`,
          pass: false,
        }, "wave")
      }
    }
    unfinished = spawnable
  }
  const cap = deps.canary?.enabled && !deps.canary.released ? 1 : slots
  if (!deps.canary?.failed) {
    while (!deps.draining && deps.inFlight.size < cap && unfinished.length > 0) {
      const unit = unfinished.shift()!
      const paths = unitPaths(deps.taskDir, unit.id)
      mkdirSync(paths.dir, { recursive: true })
      writeFileSync(paths.briefPath, briefFor(unit, deps.taskDir, deps.worktree, deps.settleMode))
      const resume = deps.resumes?.get(unit.id)
      const ok = resume
        ? resumeSpawn(deps, unit, resume, paths)
        : deps.shep.spawnWorker(
            `w-${unit.id}`,
            deps.hooks.workerKind,
            paths.briefPath,
            deps.worktree ?? paths.dir,
            deps.unitModels?.get(unit.id),
            deps.unitTemperatures?.get(unit.id),
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
        worktree: deps.worktree ?? paths.dir,
        settleAttempts: 0,
        workedSinceAttempt: false,
      })
    } else {
      const attempts = (deps.attempts.get(unit.id) ?? 0) + 1
      deps.attempts.set(unit.id, attempts)
      if (attempts >= RETRY_CAP) {
        finish(unit.id, false, {
          unit: unit.id,
          result: "spawn failed",
          pass: false,
        }, "spawn", true, false, `spawn failed ${attempts} times`)
        deps.shep.wake(unit.id, "blocked", `spawn failed ${attempts} times`)
      } else {
        // #165: arm a near-term retry — never ride the stall ladder for a
        // spawn that already failed (j-214576: attempts 2→3 took 101 min)
        deps.onSpawnRetry?.(unit.id, attempts)
      }
    }
    }
  }

  const finalState = readState(deps.taskDir)
  const finalFinished = new Set([...finalState.done, ...finalState.failed])
  const finalFailed = new Set(finalState.failed)
  if (deps.canary?.failed && deps.inFlight.size === 0) return true
  // ADR 0007: with steps declared, the run is done when every unit AND
  // every non-unit step (check, wake, gate) finished — a pending gate or
  // child job keeps the rail alive, an UNREACHABLE one (an earlier wave
  // failed) cannot, and must not. The chain owns both questions.
  const stepsFinished = deps.chain?.watched.every(
    (s) => finalFinished.has(s.id) || deps.chain!.unreachable(s, finalFailed),
  ) ?? true
  return (
    units.every((unit) => finalFinished.has(unit.id)) &&
    stepsFinished &&
    deps.inFlight.size === 0
  )
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
  bornMs?: number
  briefGraceMs?: number
  checkMs?: number
  logPollMs?: number
  gateCheckMs?: number
  deadlineMs?: number
  now?: () => number
  log?: (msg: string) => void
  emit?: (kind: string, payload: Record<string, unknown>) => void
  existingRows?: ReportRow[]
  worktree?: string
  canary?: boolean
  // Pause drain (ADR 5): the drain ceiling defaults to the manifest's
  // drain_timeout_ms, then the stall timeout. SIGTERM starts the drain
  // unless trapSignals is false (tests drive the loop another way);
  // with the port's installDrain seam the RAIL's trap delivers it.
  drainMs?: number
  trapSignals?: boolean
  resumes?: Map<string, ResumePointer>
  // Booked wait (ADR 0006): consult before settling a stall — while a
  // live child spur names the pane's session as its spawner, the wait
  // is booked and the stall stands down.
  bookedWait?: (unitId: string) => boolean
  // the provider-fault lane + the birth judge's rail seam — engine.ts
  // builds it; the run loop forwards it to every cycle (it used to
  // build it and drop it: the lane was dead code)
  faults?: CycleDeps["faults"]
  // completion-detection: "status-first" arms the platform pen (idle +
  // present deliverable settles, no marker). Absent = manifest's
  // workflow.settle_mode, absent that = "marker" (byte-identical).
  settleMode?: "marker" | "status-first"
  // Suppress the passive stall ladder (the status-first trial window —
  // the old killer must not fire while the new lane is being proven).
  fallbackLadder?: boolean
  // ADR 0016 slice 1 — station hosting: a coworker stage's exchange
  // runs in-process at stations/<id>/. The default seats runCoworker on
  // the rail (the shep port must be a Rail); tests inject a rehearsal
  // host. The host resolves with the exchange's Report (or throws).
  hostStation?: (stage: Manifest["stages"] extends (infer S)[] | undefined ? S : never, dir: string) => Promise<Report | null>
}): Promise<Report | null> {
  const loaded = input.hooks
    ? { hooks: input.hooks, manifest: input.manifest }
    : hooksFromDir(input.taskDir)
  const manifest = loaded.manifest ?? loadManifest(input.taskDir)
  // ADR 0007 stage 3: wake steps execute — the rail levies the child
  // job, books itself as spawner, and the step finishes on the child's
  // wake. No levy port (a rail that cannot spawn child jobs) still
  // refuses honestly — never a silent lie about nesting.
  // Issue #152 slice 1: [[stage]] compiles to the fan-out core —
  // steps (the chain, via waves), units (the workers), and the grade
  // plan (#150's binding). Gate stages are one-shot verdicts, not the
  // polling check steps of ADR 0007: a failed stage gate FAILS, and the
  // wave machinery finishes downstream units as blocked rows.
  // ADR 0014: stages are the only authoring dialect.
  const steps = manifest.stages ? stepsFromStages(manifest.stages) : undefined
  // ADR 0016 slice 1: member names are station-global — the rail keys
  // panes by name, so two stations repeating a member name would
  // cross-book each other's panes. Refused at boot, never crossed.
  {
    const seenMembers = new Set<string>()
    for (const stage of manifest.stages ?? []) {
      if (stage.topology !== "coworker") continue
      for (const m of stage.members ?? []) {
        if (seenMembers.has(m.name)) {
          throw new HookError(`member name ${m.name} repeats across coworker stations — the rail keys panes by name; rename one (station-scoped names land with a later slice)`)
        }
        seenMembers.add(m.name)
      }
    }
  }

  const log = input.log ?? ((msg: string) => console.log(`${new Date().toISOString()} ${msg}`))
  // (The mint is DEAD - ADR 0016 slices 1+2: coworker and lab stages
  // host in-process at stations/<id>/; nothing is copied, nothing is
  // levied. The stages/ dialect is gone from birth.)

  const stages = manifest.stages
  if (stages?.length) {
    loaded.hooks = { ...loaded.hooks, units: () => unitsFromStages(stages) }
  }
  // The chain object, declared once for the whole run: cycle's spawn
  // gate, the done condition, and the driver's step walker all ask it
  // — the wave order is walked by ONE owner (OPTIMUM §2 endgame).
  const chain = chainOf(steps)
  const stagePlan = stages?.length ? gradePlanFromStages(stages) : undefined
  const unitModels = stages?.length ? modelPlanFromStages(stages) : undefined
  const unitTemperatures = stages?.length ? settingsPlanFromStages(stages) : undefined
  const where = manifest.report?.where ?? input.taskDir
  const layout = input.layout ?? resolvedLayout(manifest)
  const slots = input.slots ?? manifest.workflow.slots ?? DEFAULT_SLOTS
  // program-declared silence ceiling (workflow.stall_ms; the r6
  // receipt — a review lens synthesizing over a big diff out-silences
  // the 10-minute default and gets ruled stalled minutes before done)
  const stallMs = input.stallMs ?? manifest.workflow.stall_ms ?? DEFAULT_STALL_MS
  // the birth judge's patience (workflow.born_ms; the j-4a0009
  // receipt — a pane that never boarded rode the whole stall ceiling;
  // 3 min default, an unboarded pane is transport class long before
  // 30)
  const bornMs = input.bornMs ?? manifest.workflow.born_ms ?? DEFAULT_BORN_MS
  const settleMode = input.settleMode ?? manifest.workflow.settle_mode ?? "marker"
  const fallbackLadder = input.fallbackLadder ?? manifest.workflow.fallback_ladder ?? true
  const briefGraceMs = input.briefGraceMs ?? DEFAULT_BRIEF_GRACE_MS
  const checkMs = input.checkMs ?? DEFAULT_CHECK_MS
  const logPollMs = input.logPollMs ?? LOG_POLL_MS
  const gateCheckMs = input.gateCheckMs ?? DEFAULT_GATE_CHECK_MS
  const deadlineMs = input.deadlineMs ?? 2 * 60 * 60_000
  const now = input.now ?? Date.now
  const inFlight = new Map<string, Flight>()
  const attempts = new Map<string, number>()
  const started = now()
  // Rows accumulate here across cycles (the events carry each finish;
  // existingRows covers a resumed orchestrator's earlier work).
  const rows: ReportRow[] = [...(input.existingRows ?? [])]
  const emit = input.emit ?? (() => {})
  // issue #40: every units/grade/counts execution lands in the trace as
  // hook.run — the window's "last fired" rides on it
  setHookRunNote((n) => emit("hook.run", n))
  const canary: CanaryState = { enabled: input.canary === true, released: false, failed: false }

  log(`orchestrator: started (taskDir=${input.taskDir}, layout=${layout.tab}/${layout.orchestrator}, idle until a queue message)`)

  input.shep.setLayout(layout, input.taskDir)
  const unitsDir = join(input.taskDir, "units")
  mkdirSync(unitsDir, { recursive: true })
  acquireUnits(input.taskDir, loaded.hooks, {
    log,
    emit: (kind, payload) => emit(kind, payload),
  })

  log(`orchestrator: the window is the viewer; this log lives at ${join(input.taskDir, "orchestrator.log")}`)

  const timers = new Set<ReturnType<typeof setTimeout>>()
  const watchers: FSWatcher[] = []
  const watchedFiles = new Set<string>()
  let running = false
  let finished = false
  let parked = false
  let draining = false
  let drainUntil: number | null = null
  const drainMs = input.drainMs ?? manifest.workflow.drain_timeout_ms ?? stallMs
  let fallback: ReturnType<typeof setInterval> | null = null
  let poller: ReturnType<typeof setInterval> | null = null

  const cleanup = () => {
    for (const t of timers) clearTimeout(t)
    timers.clear()
    if (fallback) clearInterval(fallback)
    if (poller) clearInterval(poller)
    for (const w of watchers) w.close()
    watchers.length = 0
    // note: the hook-run note is NOT cleared here — the report (and its
    // counts hook) is written after cleanup; the note comes out at the
    // run's true exits below
  }

  const run = (): void => {
    if (running || finished) return
    running = true
    try {
      const complete = cycle({
        taskDir: input.taskDir,
        hooks: loaded.hooks,
        shep: input.shep,
        inFlight,
        attempts,
        slots,
        stallMs,
        briefGraceMs,
        bornMs,
        now,
        // the provider-fault lane's wiring (j-93d652 gap #4) built this
        // object in engine.ts and NEVER FORWARDED it — the lane has
        // been dead code since it merged, and its first line would have
        // crashed (faultStateOf was a WeakMap called as a function).
        // The birth judge rides the same seam: no faults, no birth seat.
        faults: input.faults,
        worktree: input.worktree,
        canary,
        draining,
        resumes: input.resumes,
        onSpawnRetry: (unitId, attempts) => {
          // #165: the failed spawn gets a 30s retry wake — the stall
          // ladder only knows about live workers, and this one was never born
          const t = setTimeout(() => {
            timers.delete(t)
            enqueue(`spawn-retry:${unitId}:${attempts}`)
          }, SPAWN_RETRY_MS)
          timers.add(t)
        },
        bookedWait:
          input.bookedWait ??
          (settleMode === "status-first"
            ? // the receipt-backed wait-for DAG: a live child (no
              // wake.json yet) owns the parent's silence
              (unitId: string) => waitingOnLiveChild(input.taskDir, unitId)
            : undefined),
        settleMode,
        fallbackLadder,
        chain,
        stagePlan,
        unitModels,
        unitTemperatures,
        emit: (kind, payload) => {
          emit(kind, payload)
          if (kind === "unit.finished" && typeof payload.unit === "string") {
            rows.push({
              unit: payload.unit,
              result: String(payload.result ?? ""),
              pass: payload.pass === true,
            })
          }
        },
      })
      if (complete) {
        finished = true
        cleanup()
        return
      }
      if (draining) {
        if (inFlight.size === 0 && stationFlights.size === 0) {
          log("orchestrator: drained — parking paused")
          parked = true
          finished = true
          cleanup()
          return
        }
        if (drainUntil !== null && now() > drainUntil) {
          log("orchestrator: drain ceiling passed — retiring in-flight panes unfinished (sessions stay booked)")
          for (const [id] of [...inFlight]) {
            input.shep.retire(`w-${id}`)
            inFlight.delete(id)
          }
          // a hosted exchange still burning past the PARENT's ceiling:
          // its own drain was armed (LIFO) and its engine's ceiling
          // governs its members — stop waiting on it; its sessions stay
          // booked and a continue resumes the SAME station exchange
          for (const id of [...stationFlights.keys()]) {
            log(`station ${id}: past the parent's drain ceiling — parking with its sessions booked`)
            stationFlights.delete(id)
          }
          parked = true
          finished = true
          cleanup()
          return
        }
      }
      if (now() - started > deadlineMs) {
        log("orchestrator: deadline passed; settling the rest failed")
        for (const [id] of [...inFlight]) {
          record(id, "deadline", false, "deadline")
          input.shep.retire(`w-${id}`)
          inFlight.delete(id)
        }
        const state = readState(input.taskDir)
        const units = loadUnitsFor(input.taskDir, loaded.hooks)
        for (const unit of units) {
          if (!state.done.includes(unit.id) && !state.failed.includes(unit.id)) {
            record(unit.id, "deadline", false, "deadline — never started", "deadline")
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
  // finish, then park. The RAIL owns the trap (the door is kind-blind)
  // — register requestPause through the port's drain seam; a port
  // without the seam (tests with fake sheps) traps SIGTERM itself.
  // SIGINT stays an immediate stop (the bin books the abort); SIGKILL
  // cannot be caught and is the abort verb's own.
  const requestPause = (): void => {
    if (finished || draining) return
    draining = true
    drainUntil = drainDeadline(input.taskDir, now(), drainMs)
    log(`orchestrator: pause requested — draining (ceiling ${new Date(drainUntil).toISOString()})`)
    enqueue("pause")
  }
  if (input.trapSignals !== false) {
    if (input.shep.installDrain) input.shep.installDrain(requestPause)
    else process.on("SIGTERM", requestPause)
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

  // ── the chain's step machines: one walker, kind-specific executors ──
  //
  // Before: three machine loops (check polling, stage gates, wake
  // levies) each hand-rolled the same read-state → frontier-walk →
  // settle/emit/row ceremony, plus a private frontier() and two pending
  // counters. Now ONE walker visits the unfinished frontier in chain
  // order and executes each step BY ITS KIND; the executors keep only
  // what is genuinely kind-specific (checks debounce, gates fire once,
  // wakes book a child and read its receipt), and the finish ceremony
  // is the recorder's (src/orchestrator-chain.ts): one settle card,
  // one event, one report row.
  const record = stepRecorder(input.taskDir, emit, rows)
  const stateSets = () => {
    const state = readState(input.taskDir)
    return {
      finishedIds: new Set<string>([...state.done, ...state.failed]) as Set<string>,
      failedIds: new Set<string>(state.failed) as Set<string>,
    }
  }
  const gateCache = new Map<string, { at: number; pass: boolean }>()
  const stepPending = { checks: 0, stations: 0 }

  // ADR 0007: check steps poll with EXIT-CODE semantics — exit 0 passes
  // (unlike [gates] report detectors, which print "done" per ADR 0003).
  // Frontier checks are asked at most once per gateCheckMs; a pass
  // settles the gate into state and opens the downstream wave on the
  // next run(). stepPending.checks feeds arm() so a waiting gate can never
  // dead-sleep.
  const execCheck = (step: Step): boolean => {
    const cached = gateCache.get(step.id)
    if (cached && !cached.pass && now() - cached.at < gateCheckMs) return false
    let pass = false
    try {
      execSync(step.check!, { cwd: input.taskDir, timeout: 120_000, stdio: ["ignore", "ignore", "ignore"] })
      pass = true
    } catch {
      pass = false // not-yet — the debounce owns the retry
    }
    gateCache.set(step.id, { at: now(), pass })
    if (!pass) return false
    record(step.id, "gate", true, "gate passed")
    log(`gate ${step.id} passed — wave ${step.wave} can finish`)
    return true
  }

  // Issue #152: stage gates — the rail ACTS (runs the stage's command)
  // at the chain's frontier, once. Unlike ADR 0007 check steps (polling
  // readiness, debounced retry), a stage gate is a verdict: pass opens
  // the next wave; FAIL finishes the gate failed and the wave machinery
  // blocks the downstream stages honestly. The final grade stage is
  // exactly this shape — verify.sh fires once, at the end, never
  // mid-chain (#150).
  const execGate = (step: Step): boolean => {
    let pass = false
    let why = ""
    try {
      execSync(step.check!, { cwd: input.taskDir, timeout: 300_000, stdio: ["ignore", "ignore", "pipe"] })
      pass = true
    } catch (err) {
      why = err instanceof Error ? err.message.split("\n")[0] : String(err)
    }
    record(
      step.id, "gate", pass,
      pass ? "stage gate passed" : why,
      pass ? "stage gate passed" : `stage gate failed: ${why.slice(0, 120)}`,
    )
    log(`stage gate ${step.id} ${pass ? "passed — chain advances" : "FAILED — downstream blocked"}`)
    return true
  }

  // (The wake-step levy is DEAD — ADR 0016 slice 4: stages host
  // in-process; nothing mints a child, nothing polls a child's
  // wake.json, and the wakes/ accept-hop is gone. Genuine cross-
  // program commissions keep the door + one wake per commission.)

  // ADR 0016 slice 1 — station steps: a coworker stage hosts its
  // exchange IN-PROCESS at stations/<id>/ behind the hosting contract
  // (station folder + members passed by spec — the station is a
  // folder, never program bytes). ONE job carries the whole chain: the
  // mint and its child job are dead. The flight runs as a concurrent
  // promise so the beat loop keeps renewing the lease and answering
  // dialogs; idempotence is on disk (members/ + the relay ledger — a
  // re-nursed parent resumes the SAME exchange, and a finished one
  // re-reports from the stop already delivered).
  const stationFlights = new Map<string, Promise<void>>()
  const stationSettled = new Map<string, { status?: string; why?: string; parked?: boolean; checkReceipt?: boolean }>()
  const defaultHostStation = (stage: { id: string; topology?: string; members?: { name: string; brief: string; initiates?: boolean; model?: string; temperature?: number }[]; brief?: string; signal?: string; end?: string; preamble?: string; check?: string }, dir: string): Promise<Report | null> => {
    const rail = input.shep as unknown as { inhabitPane?: unknown }
    if (typeof rail.inhabitPane !== "function") {
      throw new HookError(`station ${stage.id} needs a rail that hosts its engine (inhabitPane) — this shep port cannot`)
    }
    const pre = stage.preamble ? `${stage.preamble}\n\n` : ""
    if (stage.topology === "lab") {
      // slice 2: the experiment hosts the same way — the actor's brief
      // is station-owned bytes, detectors ride the spec
      const actorFile = join(dir, "actor.md")
      if (!existsSync(actorFile)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(actorFile, `${pre}${stage.brief ?? ""}\n`)
      }
      return runLab(rail as never as import("../adapters/rail.ts").Rail, {
        station: {
          dir,
          brief: `${pre}${stage.brief ?? ""}\n`,
          workerKind: manifest.workflow.worker_kind,
          ...(stage.signal || stage.end ? { detectors: { ...(stage.signal ? { signal: stage.signal } : {}), ...(stage.end ? { end: stage.end } : {}) } } : {}),
        },
      })
    }
    mkdirSync(join(dir, "members"), { recursive: true })
    const members: Member[] = []
    for (const m of stage.members ?? []) {
      const briefFile = join(dir, "members", `${m.name}.md`)
      // briefs are STATION-owned bytes: written once at first hosting,
      // never rewritten under a live exchange (a re-nursed parent must
      // not swap the words mid-conversation)
      if (!existsSync(briefFile)) writeFileSync(briefFile, `${pre}${m.brief}\n`)
      members.push({
        name: m.name,
        ...(m.model ? { model: m.model } : {}),
        ...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
        ...(m.initiates ? { initiates: true } : {}),
      })
    }
    return runCoworker(rail as never as import("../adapters/rail.ts").Rail, {
      // the program-declared silence ceiling (workflow.stall_ms) feeds
      // BOTH engines — a station's members can synthesize marker-silent
      // exactly like a fan-out lens (self-review r6b tests-1: parsed
      // for every kind, consumed by one)
      ...(manifest.workflow.stall_ms !== undefined ? { stallMs: manifest.workflow.stall_ms } : {}),
      station: {
        dir,
        members,
        workerKind: manifest.workflow.worker_kind,
        // The stage's own check runs IN-EXCHANGE at the stop (the
        // station twin of #198's audit-before-retire), with the PARENT
        // task dir as cwd — stage checks are authored parent-relative
        // and promotion checks write into the parent's data/.
        ...(stage.check ? { check: stage.check, checkCwd: input.taskDir } : {}),
      },
    })
  }
  const execStation = (step: Step): boolean => {
    const stage = manifest.stages?.find((s) => s.id === step.id)
    if (!stage) return false
    const dir = join(input.taskDir, "stations", step.id)
    const settled = stationSettled.get(step.id)
    if (settled) {
      if (settled.parked) {
        // a parked station parks the RUN: no settle row (the exchange
        // is unfinished, not failed), the parent's own pause path takes
        // over — requestPause is idempotent, and the loop's park
        // condition waits for stationFlights to empty first
        stationFlights.delete(step.id)
        log(`station ${step.id}: exchange parked — the run parks with it`)
        requestPause()
        return true
      }
      let pass = settled.status === "done"
      let checkRow = ""
      // A coworker stage's check ran IN-EXCHANGE at the stop (the
      // engine's verdict path — #198's station twin: red got one revise
      // round while the members still lived), so the parent never
      // re-judges the same shelf. "Done" through a declared check
      // REQUIRES the receipt row — a host that ends the exchange
      // without running the check must not pass silently (its side
      // effects, like artifact promotion, would be lost). A lab stage's
      // check still runs parent-side (the actor's experiment has no
      // exchange to re-enter — its revise round is a later slice).
      if (pass && step.check && stage.topology === "coworker") {
        if (settled.checkReceipt) {
          checkRow = " — stage check passed (audited in-exchange)"
        } else {
          pass = false
          checkRow = " — the host ended the exchange without running the stage check (a station settles done only through its check)"
        }
      } else if (pass && step.check) {
        try {
          execSync(step.check, { cwd: input.taskDir, timeout: 120_000, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, WHL_UNIT: step.id } })
          checkRow = " — stage check passed"
        } catch (err) {
          pass = false
          const why = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.slice(0, 100) ?? ""
          checkRow = ` — stage check failed: ${why}`
        }
      }
      const result = `station ${step.id} ${settled.status}${settled.why ? ` — ${settled.why}` : ""}${checkRow}`
      record(step.id, "station", pass, result.slice(0, 120), result)
      log(`station ${step.id}: ${settled.status} — step ${pass ? "done" : "failed"}`)
      if (!pass) input.shep.wake(step.id, "blocked", `station exchange ${settled.status}`)
      stationFlights.delete(step.id)
      return true
    }
    if (!stationFlights.has(step.id)) {
      const protocolFile = join(dir, "protocol.json")
      if (!existsSync(protocolFile)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(protocolFile, JSON.stringify({ stage: step.id, station: dir, started: new Date().toISOString() }, null, 2) + "\n")
      }
      const host = input.hostStation ?? defaultHostStation
      const flight = (async () => {
        try {
          const report = await host(stage, dir)
          if (report === null) {
            // ADR 5 tenancy: null is PARKED, never failed — the hosted
            // engine drained to its boundary (its drain ran LIFO under
            // the parent's), sessions stay booked, and the PARENT parks
            // with it. No row, no wake; the settle branch arms the run's
            // pause.
            stationSettled.set(step.id, { parked: true })
          } else {
            stationSettled.set(step.id, {
              status: report.status,
              // the in-exchange check's receipt: the engine leaves a
              // "check" row when a declared stage check passed at the
              // stop — the parent refuses "done" without it
              checkReceipt: report.table.some((r) => r.unit === "check"),
              ...(report.status ? {} : { why: "no report from the station's engine" }),
            })
          }
        } catch (err) {
          stationSettled.set(step.id, { status: "failed", why: err instanceof HookError ? err.message : String(err) })
        }
      })()
      stationFlights.set(step.id, flight)
      emit("station.hosted", { unit: step.id, dir })
      log(`station ${step.id}: engine hosted in-process at ${dir}`)
      return true
    }
    return false
  }

  // kind-specific step execution — the walker dispatches on finished_by
  const executors: Record<"check" | "gate" | "station", (step: Step) => boolean> = {
    check: execCheck,
    gate: execGate,
    station: execStation,
  }

  // The ONE walker: every unfinished step on the chain's frontier, in
  // declaration order, executed by its kind. stepPending feeds arm() so a
  // debouncing check or a waiting child job can never dead-sleep.
  const advance = (): number => {
    let acted = 0
    stepPending.checks = 0
    stepPending.stations = 0
    if (chain.steps.length === 0) return 0
    const { finishedIds, failedIds } = stateSets()
    for (const step of chain.watched) {
      if (finishedIds.has(step.id)) continue
      if (!chain.frontier(step.wave, finishedIds, failedIds)) continue
      if (step.finished_by === "check") stepPending.checks += 1
      if (step.finished_by === "station" && stationFlights.has(step.id)) stepPending.stations += 1
      if (executors[step.finished_by](step)) acted += 1
    }
    return acted
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
        const graceWait = flight.spawnedAt + briefGraceMs - now()
        // Past grace but not reprompted means the pane was working at the
        // check (the grace ladder defers to the heartbeat) — never push a
        // negative wait (a 1ms hot loop); re-arm a short recheck so the
        // reprompt still fires when the pane goes idle.
        waits.push(graceWait > 0 ? graceWait : GRACE_RECHECK_MS)
      }
      // the birth judge's deadline (gate-r7 momentum-21/principles-27):
      // an unboarded pane's FIRST judge look must land AT bornMs — the
      // judge was written to END the stall-ceiling ride, but this loop
      // never woke for it, so the first dead-at-birth kill rode the very
      // ceiling bornMs exists to cut. Unconditional while positive (a
      // log line is NOT boarding — the worker protocol's first breath
      // writes one; only a session boards): a boarded pane's judge look
      // returns none at the no-op wake, and the wait self-consumes once
      // bornMs passes. A rebirth mints a fresh flight with its own clock.
      const birthWait = flight.spawnedAt + bornMs - now()
      if (birthWait > 0) waits.push(birthWait)
      waits.push(flight.lastChange + stallMs - now())
    }
    if (stepPending.checks > 0 || stepPending.stations > 0) waits.push(gateCheckMs)
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

  // the watcher backstop (j-ba18b7): alive only while a flight is
  // live, so an idle rail costs nothing
  const startLogPoller = (): void => {
    if (poller !== null) return
    poller = setInterval(() => kickIfReady(), logPollMs)
  }
  const stopLogPoller = (): void => {
    if (poller === null) return
    clearInterval(poller)
    poller = null
  }

  try {
    watchers.push(watch(unitsDir, () => enqueue("units")))
  } catch {
    log("orchestrator: units watch unavailable — timer wakes only")
    fallback = setInterval(() => enqueue("timer"), checkMs)
  }
  run()
  while (!finished) {
    // the lease rides the cycle (issue #123): each queue message or
    // timer wake renews the expiring leadership claim in job.json
    input.shep.renew?.()
    kickIfReady()
    for (const id of inFlight.keys()) watchPane(id)
    if (inFlight.size > 0) startLogPoller()
    else stopLogPoller()
    if (advance() > 0) {
      run()
      continue
    }
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
    setHookRunNote(null)
    return null
  }
  // The honest label (#144): two distinct stops. canary.failed = a REAL
  // answer failed and stopped the line — "canary-stopped". The other
  // shape: the canary never released because the first unit's grade
  // FAULTED (faults can't trip the gate, and can't release it either) —
  // the fleet stayed capped at 1 and the run ended stalled behind a
  // broken hook, an infra story, never an answer story. The arm-e night
  // read 28 verifier-passes as fleet hazards; the parenthetical keeps
  // the stop legible AND excluded from answer pass-rates. Fault rows
  // are derived from their rows' own prefixes — the unit ledger (the
  // OS-disk trace's unit.card events, OPTIMUM §8) carries the same
  // cards with timestamps.
  const isFaultRow = (row: ReportRow) =>
    row.result.startsWith("grade-fault:") || row.result.startsWith("grade error:")
  const faultCount = rows.filter(isFaultRow).length
  const canaryStatus = canary.failed
    ? "canary-stopped"
    : canary.enabled && !canary.released && faultCount > 0 && rows.length > 0
      ? "canary-stopped(grade-fault)"
      : undefined
  const report = writeReport(
    input.taskDir,
    where,
    rows,
    loaded.hooks.counts,
    canaryStatus,
  )
  checkpoint(input.taskDir, "report", "info", report.status)
  setHookRunNote(null)
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
