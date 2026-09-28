import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"

export type Unit = { id: string; brief: string }

export type Grade = { pass: boolean; row: string }

export type Hooks = {
  units: () => Unit[]
  grade: (unit: Unit) => Grade
  counts: (rows: { unit: string; result: string }[]) => Record<string, number>
  workerKind: "opencode" | "pi"
}

export type Manifest = {
  workflow: { name: string; worker_kind: "opencode" | "pi" }
  hooks: { units: string; grade: string; counts: string }
  report?: { where?: string }
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
  const name = str(workflow.name, "workflow.name")
  const workerKind = str(workflow.worker_kind, "workflow.worker_kind")
  if (workerKind !== "opencode" && workerKind !== "pi") {
    throw new HookError(`workflow.worker_kind must be opencode or pi: ${workerKind}`)
  }
  return {
    workflow: { name, worker_kind: workerKind },
    hooks: {
      units: str(hooks.units, "hooks.units"),
      grade: str(hooks.grade, "hooks.grade"),
      counts: str(hooks.counts, "hooks.counts"),
    },
    report: report.where ? { where: str(report.where, "report.where") } : {},
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
): { stdout: string; status: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: taskDir,
      encoding: "utf8",
      timeout: HOOK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { stdout: stdout ?? "", status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; status?: number; killed?: boolean }
    if (e.killed) throw new HookError(`hook timed out after ${HOOK_TIMEOUT_MS}ms: ${cmd}`)
    if (typeof e.status !== "number") throw err
    return { stdout: e.stdout ?? "", status: e.status }
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function runUnits(taskDir: string, manifest: Manifest): Unit[] {
  const { stdout, status } = runHook(manifest.hooks.units, taskDir)
  if (status !== 0) throw new HookError(`units hook exited ${status}: ${manifest.hooks.units}`)
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
  const resultsDir = join(taskDir, "results")
  mkdirSync(resultsDir, { recursive: true })
  const tablePath = join(resultsDir, "table.json")
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
