// The OS disk (zen 2): sessions/<sid>/ holds the session record, the
// JEV trace, and one jobs/<jid>/job.json per Job. A Job record is a
// state machine (running -> retired | aborted) with pane records and,
// on retirement, a receipt (zen 5: panes of this Job = 0). Records are
// never deleted; worktree binding is recorded, not copied.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

export type Parent = "first_mate" | "orchestrator"
export type StoodUpBy = Parent | "standalone"
export type JobState = "running" | "retired" | "aborted"

export type PaneRecord = {
  label: string
  pane?: string
  unit?: string
  born: string
  died?: string
}

export type Receipt = {
  panesRemaining: number
  panesTotal: number
  unitsDone: number
  unitsFailed: number
  status: string
  report?: string
  finished: string
}

export type JobRecord = {
  id: string
  sid: string
  stoodUpBy: StoodUpBy
  workflow: string
  task: string
  dir: string
  pid?: number
  repo?: string
  worktree?: string
  state: JobState
  created: string
  finished?: string
  panes: PaneRecord[]
  receipt?: Receipt
  abort?: { reason: string; panesRemaining: number; finished: string }
}

export type SessionRecord = {
  id: string
  created: string
  cwd: string
  repo?: string
  worktree?: string
}

export type TraceEntry = {
  ts: string
  sid: string
  jid?: string
  parent: Parent
  kind: "job" | "direct" | "worker"
  action: "admit" | "reject"
  detail: string
}

export function stateRoot(): string {
  return process.env.AGENTIC_OS_STATE ?? join(homedir(), ".local", "state", "agentic-os")
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString("hex")}`
}

export function sessionsRoot(): string {
  return join(stateRoot(), "sessions")
}

export function sessionDir(sid: string): string {
  return join(sessionsRoot(), sid)
}

function jobDir(sid: string, jid: string): string {
  return join(sessionDir(sid), "jobs", jid)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function openSession(input: { cwd: string; repo?: string; worktree?: string }): SessionRecord {
  const rec: SessionRecord = {
    id: shortId("s"),
    created: new Date().toISOString(),
    cwd: input.cwd,
    repo: input.repo,
    worktree: input.worktree,
  }
  mkdirSync(sessionDir(rec.id), { recursive: true })
  writeJson(join(sessionDir(rec.id), "session.json"), rec)
  return rec
}

export function loadSession(sid: string): SessionRecord | null {
  const path = join(sessionDir(sid), "session.json")
  return existsSync(path) ? readJson<SessionRecord>(path) : null
}

export function listSessions(): SessionRecord[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((sid) => existsSync(join(root, sid, "session.json")))
    .map((sid) => readJson<SessionRecord>(join(root, sid, "session.json")))
}

export function appendTrace(sid: string, entry: Omit<TraceEntry, "ts" | "sid">): TraceEntry {
  const full: TraceEntry = { ts: new Date().toISOString(), sid, ...entry }
  mkdirSync(sessionDir(sid), { recursive: true })
  appendFileSync(join(sessionDir(sid), "trace.jsonl"), `${JSON.stringify(full)}\n`)
  return full
}

export function readTrace(sid: string): TraceEntry[] {
  const path = join(sessionDir(sid), "trace.jsonl")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TraceEntry)
}

export function createJob(input: {
  sid: string
  stoodUpBy: StoodUpBy
  workflow: string
  task: string
  dir: string
  pid?: number
  repo?: string
  worktree?: string
}): JobRecord {
  const job: JobRecord = {
    id: shortId("j"),
    sid: input.sid,
    stoodUpBy: input.stoodUpBy,
    workflow: input.workflow,
    task: input.task,
    dir: input.dir,
    pid: input.pid,
    repo: input.repo,
    worktree: input.worktree,
    state: "running",
    created: new Date().toISOString(),
    panes: [],
  }
  writeJson(join(jobDir(input.sid, job.id), "job.json"), job)
  return job
}

export function loadJob(sid: string, jid: string): JobRecord | null {
  const path = join(jobDir(sid, jid), "job.json")
  return existsSync(path) ? readJson<JobRecord>(path) : null
}

export function saveJob(job: JobRecord): void {
  writeJson(join(jobDir(job.sid, job.id), "job.json"), job)
}

export function attachPane(job: JobRecord, pane: Omit<PaneRecord, "born">): JobRecord {
  if (!job.panes.some((p) => p.label === pane.label)) {
    job.panes.push({ born: new Date().toISOString(), ...pane })
    saveJob(job)
  }
  return job
}

export function killPane(job: JobRecord, label: string): JobRecord {
  const pane = job.panes.find((p) => p.label === label)
  if (pane && !pane.died) {
    pane.died = new Date().toISOString()
    saveJob(job)
  }
  return job
}

export function finishJob(job: JobRecord, receipt: Omit<Receipt, "finished">): JobRecord {
  job.state = "retired"
  job.finished = new Date().toISOString()
  job.receipt = { ...receipt, finished: job.finished }
  saveJob(job)
  return job
}

export function abortJob(job: JobRecord, reason: string, panesRemaining: number): JobRecord {
  job.state = "aborted"
  job.finished = new Date().toISOString()
  job.abort = { reason, panesRemaining, finished: job.finished }
  saveJob(job)
  return job
}

export function listJobs(sid?: string): JobRecord[] {
  if (!existsSync(sessionsRoot())) return []
  const sessions = sid ? [sid] : readdirSync(sessionsRoot(), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  const jobs: JobRecord[] = []
  for (const s of sessions) {
    const root = join(sessionDir(s), "jobs")
    if (!existsSync(root)) continue
    for (const j of readdirSync(root)) {
      const path = join(root, j, "job.json")
      if (existsSync(path)) jobs.push(readJson<JobRecord>(path))
    }
  }
  return jobs.sort((a, b) => a.created.localeCompare(b.created))
}

export function findJobByDir(dir: string): JobRecord | null {
  return listJobs().find((job) => job.dir === dir) ?? null
}
