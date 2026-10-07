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

export type Manifest = {
  workflow: { name: string; worker_kind: "opencode" | "pi"; slots?: number; model?: string }
  hooks: { units: string; grade: string; counts: string }
  detectors?: { signal?: string; end?: string }
  gates?: Record<string, string>
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

const HOOK_TIMEOUT_MS = 120_000
const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/

export function loadManifest(taskDir: string): Manifest {
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
  let model: string | undefined
  if (workflow.model !== undefined) {
    model = str(workflow.model, "workflow.model")
    if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new HookError(`workflow.model must be provider/model: ${model}`)
    }
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
  return {
    workflow: { name, worker_kind: workerKind, slots, model },
    hooks: {
      units: str(hooks.units, "hooks.units"),
      grade: str(hooks.grade, "hooks.grade"),
      counts: str(hooks.counts, "hooks.counts"),
    },
    detectors: signal !== undefined || end !== undefined ? detectors : undefined,
    gates: Object.keys(gates).length > 0 ? gates : undefined,
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
): { stdout: string; status: number; stderr: string } {
  try {
    const stdout = execSync(cmd, {
      cwd: taskDir,
      encoding: "utf8",
      timeout: HOOK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { stdout: stdout ?? "", status: 0, stderr: "" }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number; killed?: boolean }
    if (e.killed) throw new HookError(`hook timed out after ${HOOK_TIMEOUT_MS}ms: ${cmd}`)
    if (typeof e.status !== "number") throw err
    return { stdout: e.stdout ?? "", status: e.status, stderr: e.stderr ?? "" }
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function runUnits(taskDir: string, manifest: Manifest): Unit[] {
  const { stdout, status, stderr } = runHook(manifest.hooks.units, taskDir)
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
  const { stdout, status } = runHook(`${manifest.hooks.grade} ${quote(unit.id)}`, taskDir)
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
  const { stdout, status } = runHook(`${manifest.hooks.counts} ${quote(tablePath)}`, taskDir)
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
  const userGlobal = join(env.HOME ?? "", ".config", "agentic-os", "workflow.toml")
  if (existsSync(userGlobal)) return { path: userGlobal, origin: "user-global" }
  const builtin = join(REPO_DIR, "global", "workflow.toml")
  if (existsSync(builtin)) return { path: builtin, origin: "builtin" }
  return null
}
