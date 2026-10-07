// The project half of dag identity: a dag_id is unique inside a
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

export type DagIdentity = {
  project: string
  project_name: string
  dag_id: string
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
  dags: Record<string, { first_seen: string; versions: string[]; last_path: string }>
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
  const pid = pf?.project ?? (input.mint?.() ?? shortPid())
  if (minted) writeFileSync(file, `${JSON.stringify({ project: pid, name }, null, 2)}\n`)
  // register / refresh on the OS disk — identity lives in the file,
  // the registry is the durable index (a moved folder re-registers)
  try {
    const regPath = join(homeRoot(), "projects", `${pid}.json`)
    let reg: ProjectRegistry = { pid, name, first_seen: input.now?.() ?? new Date().toISOString(), paths: [], dags: {} }
    if (existsSync(regPath)) reg = JSON.parse(readFileSync(regPath, "utf8")) as ProjectRegistry
    if (!reg.paths.includes(dir)) reg.paths.push(dir)
    mkdirSync(join(homeRoot(), "projects"), { recursive: true })
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`)
  } catch {
    // the registry is an index, never a gate
  }
  return { pid, name, minted }
}

// dag_id: explicit in workflow.toml, else the workflow name, else a
// content hash with a loud warning — grouping never silently falls
// apart, and it always exists.
export function dagIdOf(input: { dagId?: string; name?: string; toml: string }): { dagId: string; derived: boolean } {
  if (input.dagId && input.dagId.trim()) return { dagId: input.dagId.trim(), derived: false }
  if (input.name && input.name.trim()) return { dagId: input.name.trim(), derived: false }
  return { dagId: `dag-${createHash("sha1").update(input.toml).digest("hex").slice(0, 8)}`, derived: true }
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
// carries HEAD's branch. No git, no labels — no warning either.
export function labelsFor(dir: string): Record<string, string> {
  const labels: Record<string, string> = {}
  try {
    const dot = join(dir, ".git")
    const st = statSync(dot)
    if (st.isFile()) {
      const gitdir = readFileSync(dot, "utf8").match(/gitdir:\s*(\S+)/)?.[1]
      if (gitdir) labels.worktree = basename(gitdir.replace(/\/$/, ""))
      labels.branch = labels.worktree ?? "worktree"
    } else if (st.isDirectory()) {
      const head = readFileSync(join(dot, "HEAD"), "utf8")
      labels.branch = head.match(/ref:\s*refs\/heads\/(\S+)/)?.[1] ?? "detached"
    }
  } catch {
    // no git, or unreadable — a project needs neither
  }
  return labels
}

// duplicate protection (light, by request): the same dag_id under one
// project showing different content from a different path deserves a
// loud warning — never a refusal. Versions accumulate.
export function registerDag(
  pid: string,
  dagId: string,
  hash: string,
  path: string,
  input: { now?: () => string; home?: string } = {},
): string | null {
  try {
    const root = input.home ?? homeRoot()
    const regPath = join(root, "projects", `${pid}.json`)
    if (!existsSync(regPath)) return null
    const reg = JSON.parse(readFileSync(regPath, "utf8")) as ProjectRegistry
    const dag = reg.dags[dagId]
    let warn: string | null = null
    if (dag && !dag.versions.includes(hash) && dag.last_path !== path) {
      warn = `dag_id ${dagId} already runs different content from ${dag.last_path} — versioned as new; check this is not accidental reuse`
    }
    const entry = dag ?? { first_seen: input.now?.() ?? new Date().toISOString(), versions: [], last_path: path }
    if (!entry.versions.includes(hash)) entry.versions.push(hash)
    entry.last_path = path
    reg.dags[dagId] = entry
    writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`)
    return warn
  } catch {
    return null
  }
}
