import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"
import { RefusedError } from "./backpressure.ts"
import { parseSignal, type LiveSignal } from "./live-run.ts"

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export type Unit = { id: string; brief: string }

export type Grade = { pass: boolean; row: string }

export type Hooks = {
  units: () => Unit[]
  grade: (unit: Unit) => Grade
  counts: (rows: { unit: string; result: string }[]) => Record<string, number>
  workerKind: "opencode" | "pi"
}

export type Layout = {
  tab: "same" | "new"
  orchestrator: "left" | "right"
}

// ADR 0007 — finish-typed steps. A step is a topology node typed by the
// signal that finished_by it: end (a worker's log), check (a command exits
// 0 — nothing works on it), wake (a child job's receipt). Waves are
// grouping, not steps; the report is the epilogue after the last wave.
export type Step = {
  id: string
  finished_by: "end" | "check" | "wake"
  wave: string
  brief?: string
  check?: string
  folder?: string
}

function stepsFromRaw(raw: unknown): Step[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new HookError("steps must be an array of [[step]] tables")
  const steps: Step[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const t = entry as Record<string, unknown>
    const id = str(t.id, "step.id")
    if (!SHEP_SAFE_ID.test(id)) throw new HookError(`step id is not shep-safe: ${id}`)
    if (seen.has(id)) throw new HookError(`step repeats id ${id}`)
    seen.add(id)
    const finished_by = str(t.finished_by, `step ${id} finished_by`)
    if (finished_by !== "end" && finished_by !== "check" && finished_by !== "wake") {
      throw new HookError(`step ${id} finished_by must be end, check, or wake (ADR 0007): ${finished_by}`)
    }
    const wave = typeof t.wave === "string" && t.wave ? t.wave : "main"
    const step: Step = { id, finished_by, wave }
    if (finished_by === "check") {
      step.check = str(t.check, `step ${id} check`)
    } else {
      if (t.check !== undefined) throw new HookError(`step ${id} is finished_by=${finished_by}: check belongs to check steps`)
    }
    if (finished_by === "wake") {
      step.folder = str(t.folder, `step ${id} folder`)
    } else {
      if (t.folder !== undefined) throw new HookError(`step ${id} is finished_by=${finished_by}: folder belongs to wake steps`)
    }
    if (finished_by === "end" && typeof t.brief === "string" && t.brief) step.brief = t.brief
    steps.push(step)
  }
  if (steps.length === 0) throw new HookError("steps table is empty — remove it or declare [[step]] entries")
  return steps
}

export type Manifest = {
  workflow: { name: string; worker_kind: "opencode" | "pi"; slots?: number; model?: string; spur_id?: string; drain_timeout_ms?: number; canary?: boolean }
  hooks: { units: string; grade: string; counts: string }
  detectors?: { signal?: string; end?: string }
  gates?: Record<string, string>
  steps?: Step[]
  report?: { where?: string }
  layout?: Partial<Layout>
}

export function resolvedLayout(manifest: Manifest): Layout {
  const layout = manifest.layout ?? {}
  if (layout.tab !== undefined && layout.tab !== "same" && layout.tab !== "new") {
    throw new HookError(`layout.tab must be same or new: ${layout.tab}`)
  }
  if (
    layout.orchestrator !== undefined &&
    layout.orchestrator !== "left" &&
    layout.orchestrator !== "right"
  ) {
    throw new HookError(`layout.orchestrator must be left or right: ${layout.orchestrator}`)
  }
  return {
    tab: layout.tab ?? "new",
    orchestrator: layout.orchestrator ?? "left",
  }
}

export class HookError extends Error {}

// Hook-run telemetry (issue #40): every units/grade/counts execution is
// reported through the installed note — status, target, duration — so
// the trace (and the window) can say when a hook last fired, not just
// that it exists. The rail installs the note; nothing here knows jobs.
export type HookRunNote = {
  hook: "units" | "grade" | "counts"
  target?: string
  status: number
  ms: number
}
let noteHookRun: ((note: HookRunNote) => void) | null = null
export function setHookRunNote(fn: ((note: HookRunNote) => void) | null): void {
  noteHookRun = fn
}
function note(note: HookRunNote): void {
  try {
    noteHookRun?.(note)
  } catch {
    // telemetry never breaks the hook
  }
}

// A grade hook that runs an official verifier can take minutes under
// load — the tb2 rehearsal (2026-10-14) measured ~45s solo and ~2min
// with two verifiers in parallel under Rosetta, exactly on the old hard
// 120s ceiling: a killed grade hook throws mid-cycle and takes the
// whole run with it. AGENTIC_OS_HOOK_TIMEOUT_MS overrides (min 1s, max
// 1h); the default keeps a real guardrail above the measured worst
// case.
const DEFAULT_HOOK_TIMEOUT_MS = 300_000
function hookTimeoutMs(): number {
  const raw = Number(process.env.AGENTIC_OS_HOOK_TIMEOUT_MS ?? "")
  if (Number.isFinite(raw) && raw >= 1_000) return Math.min(raw, 3_600_000)
  return DEFAULT_HOOK_TIMEOUT_MS
}
const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/

export function loadManifest(taskDir: string, warn?: (message: string) => void): Manifest {
  const path = join(taskDir, "workflow.toml")
  if (!existsSync(path)) throw new HookError(`no workflow.toml in ${taskDir}`)
  let raw: unknown
  try {
    raw = parseToml(readFileSync(path, "utf8"))
  } catch (cause) {
    throw new HookError(`workflow.toml is not valid TOML: ${cause}`)
  }
  const m = raw as Record<string, Record<string, unknown>>
  const workflow = m.workflow ?? {}
  const hooks = m.hooks ?? {}
  const report = m.report ?? {}
  const layoutRaw = m.layout ?? {}
  const detectorsRaw = m.detectors ?? {}
  const gatesRaw = m.gates ?? {}
  const tab = layoutRaw.tab
  const side = layoutRaw.orchestrator
  if (tab !== undefined && tab !== "same" && tab !== "new") {
    throw new HookError(`layout.tab must be same or new: ${tab}`)
  }
  if (side !== undefined && side !== "left" && side !== "right") {
    throw new HookError(`layout.orchestrator must be left or right: ${side}`)
  }
  const name = str(workflow.name, "workflow.name")
  const workerKind = str(workflow.worker_kind, "workflow.worker_kind")
  if (workerKind !== "opencode" && workerKind !== "pi") {
    throw new HookError(`workflow.worker_kind must be opencode or pi: ${workerKind}`)
  }
  let slots: number | undefined
  if (workflow.slots !== undefined) {
    slots = Number(workflow.slots)
    if (!Number.isInteger(slots) || slots < 1 || slots > 9) {
      throw new HookError(`workflow.slots must be an integer 1-9: ${workflow.slots}`)
    }
  }
  let drainTimeoutMs: number | undefined
  if (workflow.drain_timeout_ms !== undefined) {
    drainTimeoutMs = Number(workflow.drain_timeout_ms)
    if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1_000 || drainTimeoutMs > 3_600_000) {
      throw new HookError(`workflow.drain_timeout_ms must be an integer 1000-3600000 (ms): ${workflow.drain_timeout_ms}`)
    }
  }
  // The fan-out canary is program policy, not an env accident: a bench
  // where a failed task is a measured outcome declares canary = false
  // (no solo first unit, no run stop on its first fail) beside its
  // slots; the door still lets AGENTIC_OS_CANARY override either way.
  let canary: boolean | undefined
  if (workflow.canary !== undefined) {
    if (typeof workflow.canary !== "boolean") {
      throw new HookError(`workflow.canary must be true or false: ${String(workflow.canary)}`)
    }
    canary = workflow.canary
  }
  let model: string | undefined
  if (workflow.model !== undefined) {
    model = str(workflow.model, "workflow.model")
    if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new HookError(`workflow.model must be provider/model: ${model}`)
    }
  }
  // ADR 0009: the manifest key renames dag_id -> spur_id. spur_id wins
  // when both are present; a legacy-only dag_id still resolves, loudly.
  const SPUR_ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
  let spurId: string | undefined
  if (workflow.spur_id !== undefined) {
    spurId = str(workflow.spur_id, "workflow.spur_id")
    if (!SPUR_ID_RE.test(spurId)) {
      throw new HookError(`workflow.spur_id must be url-safe lowercase: ${spurId}`)
    }
  } else if (workflow.dag_id !== undefined) {
    spurId = str(workflow.dag_id, "workflow.dag_id")
    if (!SPUR_ID_RE.test(spurId)) {
      throw new HookError(`workflow.dag_id must be url-safe lowercase: ${spurId}`)
    }
    warn?.("legacy dag_id in workflow.toml — rename to spur_id")
  }
  const detectors: { signal?: string; end?: string } = {}
  const optCmd = (value: unknown, field: string): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== "string" || value.length === 0) {
      throw new HookError(`${field} must be a command string: ${String(value)}`)
    }
    return value
  }
  const signal = optCmd(detectorsRaw.signal, "detectors.signal")
  const end = optCmd(detectorsRaw.end, "detectors.end")
  if (signal !== undefined) detectors.signal = signal
  if (end !== undefined) detectors.end = end
  const gates: Record<string, string> = {}
  for (const [id, value] of Object.entries(gatesRaw)) {
    const cmd = optCmd(value, `gates.${id}`)
    if (cmd !== undefined) gates[id] = cmd
  }
  const steps = stepsFromRaw(m.step)
  return {
    workflow: { name, worker_kind: workerKind, slots, model, ...(spurId ? { spur_id: spurId } : {}), drain_timeout_ms: drainTimeoutMs, ...(canary !== undefined ? { canary } : {}) },
    hooks: {
      units: str(hooks.units, "hooks.units"),
      grade: str(hooks.grade, "hooks.grade"),
      counts: str(hooks.counts, "hooks.counts"),
    },
    detectors: signal !== undefined || end !== undefined ? detectors : undefined,
    gates: Object.keys(gates).length > 0 ? gates : undefined,
    steps,
    report: report.where ? { where: str(report.where, "report.where") } : {},
    layout: {
      tab: tab as "same" | "new" | undefined,
      orchestrator: side as "left" | "right" | undefined,
    },
  }
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HookError(`workflow.toml is missing ${field}`)
  }
  return value
}

function runHook(
  cmd: string,
  taskDir: string,
): { stdout: string; status: number; stderr: string; ms: number } {
  const startedAt = Date.now()
  try {
    const stdout = execSync(cmd, {
      cwd: taskDir,
      encoding: "utf8",
      timeout: hookTimeoutMs(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { stdout: stdout ?? "", status: 0, stderr: "", ms: Date.now() - startedAt }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number; killed?: boolean }
    if (e.killed) throw new HookError(`hook timed out after ${hookTimeoutMs()}ms: ${cmd}`)
    if (typeof e.status !== "number") throw err
    return { stdout: e.stdout ?? "", status: e.status, stderr: e.stderr ?? "", ms: Date.now() - startedAt }
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// Steps define the units (ADR 0007): end-steps ARE the units, briefs
// read from members/<id>.md unless the step names another path. Check
// and wake steps are topology — never units.
export function unitsFromSteps(taskDir: string, steps: Step[]): Unit[] {
  const units: Unit[] = []
  for (const step of steps) {
    if (step.finished_by !== "end") continue
    const briefPath = step.brief ?? join(taskDir, "members", `${step.id}.md`)
    let brief: string
    try {
      brief = readFileSync(briefPath, "utf8")
    } catch {
      throw new HookError(`end step ${step.id} has no brief: ${briefPath} does not exist`)
    }
    units.push({ id: step.id, brief })
  }
  if (units.length === 0) throw new HookError("steps declare no end steps — nothing can run")
  return units
}

export function runUnits(taskDir: string, manifest: Manifest): Unit[] {
  const { stdout, status, stderr, ms } = runHook(manifest.hooks.units, taskDir)
  note({ hook: "units", status, ms })
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || "units hook exited 75")
  if (status !== 0) {
    throw new HookError(`units hook exited ${status}: ${manifest.hooks.units}\n${stderr.split("\n")[0] ?? ""}`)
  }
  const units: Unit[] = []
  const seen = new Set<string>()
  const lines = stdout.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let parsed: { id?: unknown; brief?: unknown }
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new HookError(`units hook line ${i + 1} is not JSON: ${line}`)
    }
    if (typeof parsed.id !== "string" || !SHEP_SAFE_ID.test(parsed.id)) {
      throw new HookError(`units hook line ${i + 1} id is not shep-safe: ${parsed.id}`)
    }
    if (seen.has(parsed.id)) throw new HookError(`units hook repeats id ${parsed.id}`)
    seen.add(parsed.id)
    units.push({ id: parsed.id, brief: typeof parsed.brief === "string" ? parsed.brief : "" })
  }
  if (units.length === 0) throw new HookError("units hook produced no units")
  return units
}

export function runGrade(taskDir: string, manifest: Manifest, unit: Unit): Grade {
  const { stdout, status, ms } = runHook(`${manifest.hooks.grade} ${quote(unit.id)}`, taskDir)
  note({ hook: "grade", target: unit.id, status, ms })
  const row = stdout.split("\n")[0]?.trim()
  return { pass: status === 0, row: row || (status === 0 ? "ok" : "failed") }
}

export function runCounts(
  taskDir: string,
  manifest: Manifest,
  table: { unit: string; result: string }[],
): Record<string, number> {
  const tablePath = join(taskDir, "table.json")
  writeFileSync(tablePath, JSON.stringify(table))
  const { stdout, status, ms } = runHook(`${manifest.hooks.counts} ${quote(tablePath)}`, taskDir)
  note({ hook: "counts", status, ms })
  if (status !== 0) throw new HookError(`counts hook exited ${status}: ${manifest.hooks.counts}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new HookError(`counts hook did not print JSON: ${stdout.slice(0, 80)}`)
  }
  const counts: Record<string, number> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "number") {
      throw new HookError(`counts hook count ${name} is not a number: ${value}`)
    }
    counts[name] = value
  }
  return counts
}

// Detectors: the program names where the photograph comes from; the
// rail still decides. Same contract as every hook — exit 75 = the
// provider refused (the rail retries), anything else is deterministic.
export function runSignalDetector(taskDir: string, manifest: Manifest): LiveSignal {
  const cmd = manifest.detectors?.signal
  if (!cmd) throw new HookError("no signal detector in workflow.toml")
  const { stdout, status, stderr } = runHook(cmd, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || "signal detector exited 75")
  if (status !== 0) throw new HookError(`signal detector exited ${status}: ${cmd}`)
  // a detector that prints nothing has nothing to say yet — no signal
  if (stdout.trim() === "") return { kind: "missing" }
  return parseSignal(stdout)
}

export function runEndDetector(taskDir: string, manifest: Manifest, unitId: string): string | null {
  const cmd = manifest.detectors?.end
  if (!cmd) throw new HookError("no end detector in workflow.toml")
  const { stdout, status, stderr } = runHook(`${cmd} ${quote(unitId)}`, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || "end detector exited 75")
  if (status !== 0) throw new HookError(`end detector exited ${status}: ${cmd}`)
  const line = stdout.split("\n")[0]?.trim() ?? ""
  if (line === "") return null
  if (line === "done" || line === "blocked" || line === "dead") return line
  throw new HookError(`end detector must print done, blocked, dead, or nothing: ${line.slice(0, 60)}`)
}

export function runGateDetector(taskDir: string, manifest: Manifest, gateId: string): boolean {
  const cmd = manifest.gates?.[gateId]
  if (!cmd) throw new HookError(`no [gates] ${gateId} detector in workflow.toml`)
  const { stdout, status, stderr } = runHook(cmd, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || `gate ${gateId} exited 75`)
  if (status !== 0) throw new HookError(`gate ${gateId} detector exited ${status}: ${cmd}`)
  return stdout.split("\n")[0]?.trim() === "done"
}

export function hooksFromDir(taskDir: string): { hooks: Hooks; manifest: Manifest } {
  const manifest = loadManifest(taskDir)
  return {
    manifest,
    hooks: {
      units: () => runUnits(taskDir, manifest),
      grade: (unit) => runGrade(taskDir, manifest, unit),
      counts: (table) => runCounts(taskDir, manifest, table),
      workerKind: manifest.workflow.worker_kind,
    },
  }
}

export type ManifestOrigin = "local" | "env" | "user-global" | "builtin"

export function resolveManifestPath(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { path: string; origin: ManifestOrigin } | null {
  const local = join(cwd, "workflow.toml")
  if (existsSync(local)) return { path: local, origin: "local" }
  if (env.AGENTIC_OS_WORKFLOW && existsSync(env.AGENTIC_OS_WORKFLOW)) {
    return { path: resolve(env.AGENTIC_OS_WORKFLOW), origin: "env" }
  }
  if (env.AGENTIC_OS_GLOBAL === "0") return null
  // ADR 0011: the global manifest lives in ~/.config/whitehartlane/;
  // a legacy ~/.config/agentic-os/workflow.toml is still honored.
  const nextGlobal = join(env.HOME ?? "", ".config", "whitehartlane", "workflow.toml")
  if (existsSync(nextGlobal)) return { path: nextGlobal, origin: "user-global" }
  const userGlobal = join(env.HOME ?? "", ".config", "agentic-os", "workflow.toml")
  if (existsSync(userGlobal)) return { path: userGlobal, origin: "user-global" }
  const builtin = join(REPO_DIR, "global", "workflow.toml")
  if (existsSync(builtin)) return { path: builtin, origin: "builtin" }
  return null
}
