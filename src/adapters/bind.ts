// Bind a session to one gwt worktree in the target repo. Project bytes
// live there. The OS disk keeps the pointer. A worktree already bound
// to a live session (running or orphaned job) is refused.
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { saveSession, type JobRecord, type SessionRecord } from "./store.ts"

export function findGwtRoot(cwd: string): string | null {
  const fromEnv = process.env.AGENTIC_OS_GWT_ROOT
  if (fromEnv) return resolve(fromEnv)
  let dir = resolve(cwd)
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".bear"))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function slugFor(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
  return slug || "task"
}

export function parseGwtPath(output: string): string | null {
  const match = output.match(/^\s*path:\s+(\S+)/m)
  return match?.[1] ?? null
}

export function spawnGwt(root: string, name: string): { path: string } | { error: string } {
  try {
    const out = execFileSync("gwt", ["spawn", name], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    })
    const path = parseGwtPath(out)
    if (!path) return { error: `gwt spawn printed no path: ${out.slice(0, 160)}` }
    return { path }
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    return { error: (e.stderr || e.message || "gwt spawn failed").split("\n")[0] ?? "gwt spawn failed" }
  }
}

export function bindWorktree(input: {
  session: SessionRecord
  task: string
  root: string
  spawn?: (root: string, name: string) => { path: string } | { error: string }
  liveWorktrees?: string[]
}): { worktree: string; repo: string; created: boolean } | { error: string } {
  const spawn = input.spawn ?? spawnGwt
  const live = new Set(input.liveWorktrees ?? [])
  if (input.session.worktree && existsSync(input.session.worktree)) {
    return { worktree: input.session.worktree, repo: input.session.repo ?? input.root, created: false }
  }
  const spawned = spawn(input.root, slugFor(input.task))
  if ("error" in spawned) return spawned
  if (live.has(spawned.path)) {
    return { error: `worktree already bound to a live session: ${spawned.path}` }
  }
  input.session.repo = input.root
  input.session.worktree = spawned.path
  saveSession(input.session)
  return { worktree: spawned.path, repo: input.root, created: true }
}

export function liveWorktrees(sessions: SessionRecord[], jobs: JobRecord[], exceptSid?: string): string[] {
  const liveSids = new Set(
    jobs.filter((job) => job.state === "running" || job.state === "orphaned").map((job) => job.sid),
  )
  return sessions
    .filter((session) => session.id !== exceptSid && session.worktree && liveSids.has(session.id))
    .map((session) => session.worktree!)
}
