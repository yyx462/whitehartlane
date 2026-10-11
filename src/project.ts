// The project half of spur identity: a spur_id is unique inside a
// Project, and a Project is a pid minted once, kept in project.json
// inside the program folder, registered on the OS disk. Worktrees and
// clones copy the file, so runs combine under one group wherever the
// folder lives — no warning, by design. Branch and lane are labels,
// never identity. Paths are never identity: move the folder, the
// trace continues.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

export type SpurIdentity = {
  project: string
  project_name: string
  spur_id: string
  content_hash: string
  source: string
  labels?: Record<string, string>
}

export type ProjectFile = { project: string; name: string }

export type ProjectRegistry = {
  pid: string
  name: string
  first_seen: string
  paths: string[]
  // ADR 0009: registries before the rename spelled this block `dags` —
  // read both, write the new spelling
  spurs: Record<string, { first_seen: string; versions: string[]; last_path: string }>
}

function homeRoot(): string {
  return process.env.AGENTIC_OS_HOME ?? join(homedir(), ".local", "share", "agentic-os")
}

function shortPid(): string {
  return `p-${createHash("sha1").update(`${Date.now()}${Math.random()}`).digest("hex").slice(0, 6)}`
}

export function ensureProject(
  dir: string,
  input: { now?: () => string; mint?: () => string } = {},
): { pid: string; name: string; minted: boolean } {
  const file = join(dir, "project.json")
  let pf: ProjectFile | null = null
  try {
    pf = JSON.parse(readFileSync(file, "utf8")) as ProjectFile
  } catch {
    pf = null
  }
  const minted = pf === null
  const name = pf?.name ?? basename(dir)
  // uniqueness is checked, not prayed for: re-mint while the registry
  // already holds the pid (6 random hex ≈ 16.7M, but birthday risk is
  // real at scale — the registry is the arbiter)
  let pid = pf?.project ?? ""
  if (minted) {
    while (pid === "" || existsSync(join(homeRoot(), "projects", `${pid}.json`))) {
      pid = input.mint?.() ?? shortPid()
    }
    writeFileSync(file, `${JSON.stringify({ project: pid, name }, null, 2)}\n`)
  }
  // register / refresh on the OS disk — identity lives in the file,
  // the registry is the durable index (a moved folder re-registers)
  try {
    const regPath = join(homeRoot(), "projects", `${pid}.json`)
    let reg: ProjectRegistry = { pid, name, first_seen: input.now?.() ?? new Date().toISOString(), paths: [], spurs: {} }
    if (existsSync(regPath)) reg = JSON.parse(readFileSync(regPath, "utf8")) as ProjectRegistry
    if (!reg.paths.includes(dir)) reg.paths.push(dir)
    mkdirSync(join(homeRoot(), "projects"), { recursive: true })
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`)
  } catch {
    // the registry is an index, never a gate
  }
  return { pid, name, minted }
}

// spur_id: explicit in workflow.toml, else the workflow name, else a
// content hash with a loud warning — grouping never silently falls
// apart, and it always exists.
export function spurIdOf(input: { spurId?: string; name?: string; toml: string }): { spurId: string; derived: boolean } {
  if (input.spurId && input.spurId.trim()) return { spurId: input.spurId.trim(), derived: false }
  if (input.name && input.name.trim()) return { spurId: input.name.trim(), derived: false }
  return { spurId: `spur-${createHash("sha1").update(input.toml).digest("hex").slice(0, 8)}`, derived: true }
}

// the version of a program: sha1 over the staged files, sorted —
// cheap, deterministic, and every content change is a new version.
export function contentHashOf(dir: string): string {
  const h = createHash("sha1")
  const walk = (d: string) => {
    const entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const p = join(d, e.name)
      h.update(e.name)
      if (e.isDirectory()) walk(p)
      else h.update(readFileSync(p))
    }
  }
  walk(dir)
  return h.digest("hex").slice(0, 12)
}

// branch and worktree are labels, best-effort, never identity: a .git
// FILE is a worktree (its gitdir basename names the lane); a .git dir
// carries HEAD's branch. A program folder often sits nested inside a
// repo, so walk up for it. No git anywhere, no labels — no warning.
export function labelsFor(dir: string): Record<string, string> {
  const labels: Record<string, string> = {}
  let here = dir
  for (let up = 0; up < 8; up++) {
    const dot = join(here, ".git")
    try {
      const st = statSync(dot)
      if (st.isFile()) {
        const gitdir = readFileSync(dot, "utf8").match(/gitdir:\s*(\S+)/)?.[1]
        if (gitdir) labels.worktree = basename(gitdir.replace(/\/$/, ""))
        labels.branch = labels.worktree ?? "worktree"
      } else if (st.isDirectory()) {
        const head = readFileSync(join(dot, "HEAD"), "utf8")
        labels.branch = head.match(/ref:\s*refs\/heads\/(\S+)/)?.[1] ?? "detached"
      } else {
        here = join(here, "..")
        continue
      }
      return labels
    } catch {
      here = join(here, "..")
    }
  }
  return labels
}

// duplicate protection (light, by request): the same spur_id under one
// project showing different content from a different path deserves a
// loud warning — never a refusal. Versions accumulate.
export function registerSpur(
  pid: string,
  spurId: string,
  hash: string,
  path: string,
  input: { now?: () => string; home?: string } = {},
): string | null {
  try {
    const root = input.home ?? homeRoot()
    const regPath = join(root, "projects", `${pid}.json`)
    if (!existsSync(regPath)) return null
    const reg = JSON.parse(readFileSync(regPath, "utf8")) as ProjectRegistry
    const spurs = reg.spurs ?? (reg as { dags?: ProjectRegistry["spurs"] }).dags ?? {}
    const spur = spurs[spurId]
    let warn: string | null = null
    if (spur && !spur.versions.includes(hash) && spur.last_path !== path) {
      warn = `spur_id ${spurId} already runs different content from ${spur.last_path} — versioned as new; check this is not accidental reuse`
    }
    const entry = spur ?? { first_seen: input.now?.() ?? new Date().toISOString(), versions: [], last_path: path }
    if (!entry.versions.includes(hash)) entry.versions.push(hash)
    entry.last_path = path
    reg.spurs = { ...spurs, [spurId]: entry }
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`)
    return warn
  } catch {
    return null
  }
}
