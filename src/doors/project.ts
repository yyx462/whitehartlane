// The project half of spur identity: a spur_id is unique inside a
// Project, and a Project is a pid minted once, kept in project.json
// inside the program folder, registered on the OS disk. Worktrees and
// clones copy the file, so runs combine under one group wherever the
// folder lives — no warning, by design. Branch and lane are labels,
// never identity. Paths are never identity: move the folder, the
// trace continues.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative } from "node:path"
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
  if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
  // ADR 0011: the disk default is ~/.local/share/whitehartlane; a legacy
  // agentic-os disk still wins while it is the only one that exists
  // (read both, write the new spelling — the ADR 0009 pattern).
  const next = join(homedir(), ".local", "share", "whitehartlane")
  const old = join(homedir(), ".local", "share", "agentic-os")
  return existsSync(old) && !existsSync(next) ? old : next
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
// apart, and it always exists. A name only SERVES as an id when it
// passes the id grammar (a path-laden task line is a name, not a
// lineage key): otherwise the hash branch answers, loudly.
export function spurIdOf(input: { spurId?: string; name?: string; toml: string }): { spurId: string; derived: boolean } {
  if (input.spurId && input.spurId.trim()) return { spurId: input.spurId.trim(), derived: false }
  if (input.name && input.name.trim() && validateSpurId(input.name.trim()) === null) {
    return { spurId: input.name.trim(), derived: false }
  }
  return { spurId: `spur-${createHash("sha1").update(input.toml).digest("hex").slice(0, 8)}`, derived: true }
}

// the version of a program: sha1 over the staged files, sorted —
// cheap, deterministic, and every content change is a new version.
// the OUTPUT SEATS — files that land DURING a run as the chain's own
// record (the verdict link, the merge marker). They are skipped at
// EVERY root (principles-109): the program root hashes data/review/
// merge.json, but the copyBeside site hashes with root = source/DATA,
// where the same file's relative path is review/merge.json — a
// root-relative skip set was neutral at one site and INPUT at the
// other, and the identity moved mid-run exactly there.
const OUTPUT_SEATS = ["data/review/verdict.json", "data/review/merge.json"]
const isOutputSeat = (rel: string): boolean =>
  OUTPUT_SEATS.some((s) => rel === s || rel.endsWith(`/${s}`) || rel === s.slice("data/".length))
export function contentHashOf(dir: string, exclude: string[] = []): string {
  const h = createHash("sha1")
  // the verdict SEAT is output, never input (questions-20): a symlink
  // at data/review/verdict.json (into the job's run dir) must never
  // move the program's identity — the consumer's receipt compares the
  // hash and calls a moved seat "program changed since booking". The
  // merge stage's outcome marker (questions-26) is the same kind of
  // seat: it lands DURING the run, so it must be just as neutral.
  const skip = new Set([...OUTPUT_SEATS, ...exclude])
  const walk = (d: string, rel: string) => {
    const entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const p = join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (skip.has(r) || isOutputSeat(r)) continue
      h.update(e.name)
      if (e.isDirectory()) walk(p, r)
      else if (e.isSymbolicLink()) {
        // a LINK is a seat, not content (2026-10-30, principles-3000):
        // the staged program's verdict seat points into the job's run
        // dir and resolves only once the rail has judged. Hashing its
        // TARGET would make every re-levy look like a different program
        // (the settled fold then re-runs every lens).
        h.update(`link:${e.name}`)
      } else {
        try {
          h.update(readFileSync(p))
        } catch (err) {
          if ((err as { code?: string }).code !== "ENOENT") throw err
          h.update(`link:${e.name}`)
        }
      }
    }
  }
  walk(dir, "")
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

// The scope root — the commissioning worktree. The registry is scoped
// by it (paths scope the registry, they are never identity): git's own
// worktree top when the program sits in a repo, else the program dir
// ITSELF — a scope models a worktree, and where there is no worktree
// there is nothing for a neighbor's spur_id to collide with (a copied
// program folder outside git is its own scope, its own lineage — the
// same session-per-dir continuity the host binding always gave).
// realpath first — a symlinked or /private-aliased path must not become
// two scopes. Best-effort: no git, no error, dir wins.
export function scopeRootOf(dir: string): string {
  let real = dir
  try {
    real = realpathSync(dir)
  } catch {
    /* keep dir */
  }
  try {
    const top = execFileSync("git", ["-C", real, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (top) return realpathSync(top)
  } catch {
    /* not a repo — the dir is its own scope */
  }
  return real
}

// A spur_id is a lineage name worn for its whole life — refuse at the
// door what cannot be typed, keyed, or grepped later. Derived ids
// (spur-<hash>) pass by construction; only explicit ones are checked.
export function validateSpurId(id: string): string | null {
  if (id !== id.trim()) return `spur_id "${id}" has surrounding whitespace`
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return `spur_id "${id}" must match ^[a-z0-9][a-z0-9-*$] (lowercase, digits, dashes)`
  }
  if (id.length > 64) return `spur_id "${id}" longer than 64 chars`
  return null
}

// rel_source: the program dir relative to its scope root, realpathed —
// /tmp and /private/tmp must not spell two sources. The only path ever
// COMPARED, and only within one scope.
export function relSourceOf(dir: string, scopeRoot: string): string {
  let real = dir
  try {
    real = realpathSync(dir)
  } catch {
    /* keep dir */
  }
  return relative(scopeRoot, real) || "."
}

// Duplicate [[stage]] ids in one workflow.toml are Airflow's
// duplicate-task-id refusal: two stages answering one name would merge
// two step histories silently. Refuse at the door, where the fix is a
// one-line rename instead of a corrupted trace.
export function duplicateStageIds(dir: string): string[] {
  try {
    const toml = readFileSync(join(dir, "workflow.toml"), "utf8")
    const ids: string[] = []
    const seen = new Set<string>()
    const dup = new Set<string>()
    for (const m of toml.matchAll(/^\s*\[\[stage\]\]([\s\S]*?)(?=^\s*\[\[|\s*$)/gm)) {
      const id = m[1].match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1]
      if (!id) continue
      ids.push(id)
      if (seen.has(id)) dup.add(id)
      seen.add(id)
    }
    return [...dup]
  } catch {
    return []
  }
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
