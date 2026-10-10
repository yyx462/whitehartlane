// The OS disk (zen 2): ~/.local/share/agentic-os (AGENTIC_OS_HOME).
// sessions/<sid>/ holds the session record (with its host binding — a
// pointer, never a copy), events.jsonl (THE trace: append-only, one
// line per fact), and jobs/<jid>/{job.json,run/}. job.json is a
// projection of events; records are never deleted (zen 5: retired is a
// state, not rm).
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { loadManifest } from "./hooks.ts"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

export type HostBinding = {
  tool: string
  session_id: string
  session_file?: string
}

export type Parent = "levy" | "orchestrator" | "first_mate" // first_mate: legacy wire value from before the levy rename
export type StoodUpBy = Parent | "standalone"
// orphaned: the orchestrator died without a graceful stop — the Job is
// parked in the ask-first continue queue, not finished (zen 5).
// paused: the orchestrator drained to its boundary and parked on
// purpose (ADR 5) — not a finish; continue resumes it.
export type JobState = "running" | "paused" | "orphaned" | "retired" | "aborted"

export type TranscriptPointer = {
  tool: string
  cwd: string
  since: string
  // The host session id, booked the moment the tool reports it — the
  // handle a Continue resumes (ADR 5). Absent when the tool never
  // reported one; continue then degrades to a briefed fresh worker.
  session_id?: string
}

// A fork's seed (zen 6): the host session a new pane's conversation
// starts from — a pointer, never a copy; the original is never written.
export type SeedPointer = {
  tool: string
  session_id: string
  since: string
}

// Dag identity: the group a run belongs to. project is a minted pid
// (project.json in the program folder); dag_id is unique inside it;
// content_hash versions the staged program; branch/worktree are labels.
export type DagIdentity = {
  project: string
  project_name: string
  dag_id: string
  content_hash: string
  source: string
  labels?: Record<string, string>
}

export type PaneRecord = {
  label: string
  pane?: string
  unit?: string
  parent?: Parent
  transcript?: TranscriptPointer
  seed?: SeedPointer
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
  dag?: DagIdentity
  state: JobState
  created: string
  finished?: string
  panes: PaneRecord[]
  relaunches?: number
  continues?: number
  orphan?: { reason: string; panesRemaining: number; at: string }
  pause?: { reason: string; panesRemaining: number; at: string }
  receipt?: Receipt
  abort?: { reason: string; panesRemaining: number; finished: string }
  spawner?: SpawnerPointer
  woke?: { at: string; message: string; delivery?: WakeDelivery; to?: string }
  promoted?: { at: string; note: string }
  // ADR 0006 §3 — a fork delivered the booked wake into a reborn levy
  // pane; the wake is consumed, not re-delivered.
  consumed?: { at: string; via: "fork"; label: string; pane?: string }
}

// ADR 0006: the levy — the main agent that stood the Job up, booked at spawn.
// `since` is the checkpoint — a point in the FM's own transcript, never
// a copy. A whl fork reborn points back here and nowhere else.
export type SpawnerPointer = {
  tool: string
  session_id: string
  since: string
}

export type SessionRecord = {
  id: string
  created: string
  cwd: string
  repo?: string
  worktree?: string
  host?: HostBinding
}

export type OsEvent = {
  ts: string
  actor: string
  kind: string
  sid?: string
  jid?: string
} & Record<string, unknown>

export function homeRoot(): string {
  return process.env.AGENTIC_OS_HOME ?? join(homedir(), ".local", "share", "agentic-os")
}

export function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString("hex")}`
}

export function sessionsRoot(): string {
  return join(homeRoot(), "sessions")
}

export function sessionDir(sid: string): string {
  return join(sessionsRoot(), sid)
}

export function eventsPath(sid: string): string {
  return join(sessionDir(sid), "events.jsonl")
}

export function jobDir(sid: string, jid: string): string {
  return join(sessionDir(sid), "jobs", jid)
}

export function jobRunDir(sid: string, jid: string): string {
  return join(jobDir(sid, jid), "run")
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

// -- sessions -----------------------------------------------------------------

export function openSession(input: {
  cwd: string
  repo?: string
  worktree?: string
  host?: HostBinding
}): SessionRecord {
  const rec: SessionRecord = {
    id: shortId(input.host ? "s" : "auto"),
    created: new Date().toISOString(),
    cwd: input.cwd,
    repo: input.repo,
    worktree: input.worktree,
    host: input.host,
  }
  mkdirSync(sessionDir(rec.id), { recursive: true })
  writeJson(join(sessionDir(rec.id), "session.json"), rec)
  return rec
}

export function saveSession(session: SessionRecord): void {
  writeJson(join(sessionDir(session.id), "session.json"), session)
}

export function loadSession(sid: string): SessionRecord | null {
  const path = join(sessionDir(sid), "session.json")
  return existsSync(path) ? readJson<SessionRecord>(path) : null
}

export function listSessions(): SessionRecord[] {
  if (!existsSync(sessionsRoot())) return []
  return readdirSync(sessionsRoot())
    .filter((sid) => existsSync(join(sessionsRoot(), sid, "session.json")))
    .map((sid) => readJson<SessionRecord>(join(sessionsRoot(), sid, "session.json")))
}

// Duplicate rule 1: one OS session per host conversation. Find-or-create
// keyed on (tool, host session id) — a host chat resumed or restarted
// reuses its OS session; a new chat gets a new one.
export function findSessionByHost(tool: string, sessionId: string): SessionRecord | null {
  return listSessions().find((s) => s.host?.tool === tool && s.host.session_id === sessionId) ?? null
}

export function findOrOpenSession(input: {
  cwd: string
  repo?: string
  worktree?: string
  host?: HostBinding
}): { session: SessionRecord; created: boolean } {
  if (input.host) {
    const found = findSessionByHost(input.host.tool, input.host.session_id)
    if (found) return { session: found, created: false }
  }
  return { session: openSession(input), created: true }
}

// -- events (the trace) --------------------------------------------------------

export function appendEvent(sid: string, event: Omit<OsEvent, "ts" | "sid"> & { ts?: string }): OsEvent {
  const { ts, ...rest } = event
  const full: OsEvent = { ts: ts ?? new Date().toISOString(), sid, ...rest }
  mkdirSync(sessionDir(sid), { recursive: true })
  appendFileSync(eventsPath(sid), `${JSON.stringify(full)}\n`)
  return full
}

export function readEvents(sid: string): OsEvent[] {
  if (!existsSync(eventsPath(sid))) return []
  return readFileSync(eventsPath(sid), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as OsEvent)
}

export function readAllEvents(): { sid: string; events: OsEvent[] }[] {
  return listSessions().map((s) => ({ sid: s.id, events: readEvents(s.id) }))
}

// -- jobs (records are projections of events) -----------------------------------

export function createJob(input: {
  sid: string
  stoodUpBy: StoodUpBy
  workflow: string
  task: string
  dir?: string
  runDir?: boolean
  pid?: number
  repo?: string
  worktree?: string
  dag?: DagIdentity
  spawner?: SpawnerPointer
}): JobRecord {
  const id = shortId("j")
  const job: JobRecord = {
    id,
    sid: input.sid,
    stoodUpBy: input.stoodUpBy,
    workflow: input.workflow,
    task: input.task,
    dir: input.dir ?? (input.runDir ? jobRunDir(input.sid, id) : ""),
    pid: input.pid,
    repo: input.repo,
    worktree: input.worktree,
    dag: input.dag,
    spawner: input.spawner,
    state: "running",
    created: new Date().toISOString(),
    panes: [],
  }
  appendEvent(input.sid, {
    actor: input.stoodUpBy,
    kind: "job.born",
    jid: job.id,
    dir: job.dir,
    task: job.task,
    ...(job.dag ? { dag: job.dag } : {}),
  })
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

export function attachPane(
  job: JobRecord,
  pane: { label: string; pane?: string; unit?: string; parent?: Parent; transcript?: TranscriptPointer; seed?: SeedPointer },
): JobRecord {
  if (!job.panes.some((p) => p.label === pane.label)) {
    const born = new Date().toISOString()
    job.panes.push({ born, ...pane })
    saveJob(job)
    appendEvent(job.sid, {
      actor: "orchestrator",
      kind: "pane.born",
      jid: job.id,
      label: pane.label,
      pane: pane.pane,
      unit: pane.unit,
      parent: pane.parent,
      transcript: pane.transcript,
      seed: pane.seed,
    })
  }
  return job
}

export function killPane(job: JobRecord, label: string): JobRecord {
  const pane = job.panes.find((p) => p.label === label)
  if (pane && !pane.died) {
    pane.died = new Date().toISOString()
    saveJob(job)
    appendEvent(job.sid, { actor: "orchestrator", kind: "pane.died", jid: job.id, label })
  }
  return job
}

// ADR 0006 — the end-of-job wake: exactly one message to the levy
// that stood the Job up ("spur for task X done — report at …").
// Layered delivery: wake.json on the job dir (durable), one job.woke
// trace event, `woke` on the record as the once-guard, then — in
// order — an in-band prompt to a live pane holding the spawner's host
// session (a pane levy: the wake lands in its conversation), the
// machine's notify CLI doorbell as fallback (best-effort; AGENTIC_OS_NOTIFY=0
// or absence disables), and the durable record waiting for `whl fork`.
// No spawner -> no wake (the Job is unattended, nothing to tell).
export type WakeDelivery = "pane" | "doorbell" | "queued"

export type WakePort = {
  // prompt a live pane (herdr agent prompt <label>); false = not live
  promptPane?: (label: string, message: string) => boolean
  // the doorbell fallback (notify CLI)
  notify?: (message: string) => void
}

export function wakeFirstMate(
  job: JobRecord,
  outcome: string,
  report: string | null,
  port: WakePort = {},
): JobRecord {
  if (!job.spawner || job.woke) return job
  const at = new Date().toISOString()
  const where = report ?? join(job.dir, "report.json")
  const message = `spur for task "${job.task}" ${outcome} — check ${where}`
  const wake = {
    to: job.spawner,
    jid: job.id,
    task: job.task,
    outcome,
    message,
    report: where,
    at,
  }
  try {
    mkdirSync(job.dir, { recursive: true })
    writeFileSync(join(job.dir, "wake.json"), JSON.stringify(wake, null, 2) + "\n")
  } catch {
    /* the trace event below still books the wake */
  }
  // ADR 0007 stage 3 — a rail spawner is a process, not a conversation:
  // no pane holds it and no doorbell serves it. The durable wake.json
  // IS the receipt the parent rail polls; delivery stays "queued".
  const railSpawner = job.spawner.tool === "rail"
  // delivery 1: in-band — a live pane of a running Job holds the
  // spawner's host session (spurs may nest; the wake goes to the
  // pointer regardless)
  let delivery: WakeDelivery = "queued"
  let to: string | undefined
  const promptPane = railSpawner
    ? undefined
    :
    port.promptPane ??
    ((label, text) => {
      try {
        return spawnSync("herdr", ["agent", "prompt", label, text], { timeout: 30_000 }).status === 0
      } catch {
        return false
      }
    })
  const holder = findLivePaneForSpawner(job.spawner.session_id, job.id)
  if (holder && promptPane(holder.label, `[wake] ${message}`)) {
    delivery = "pane"
    to = holder.label
  }
  // delivery 2 (fallback): the doorbell — the levy is a chat a person
  // holds, or no live pane took the prompt. A rail spawner skips it:
  // machines are not doorbelled.
  if (delivery !== "pane" && !railSpawner) {
    const notify =
      port.notify ??
      ((text) => {
        const cli = join(homedir(), ".local", "bin", "notify")
        if (process.env.AGENTIC_OS_NOTIFY !== "0" && existsSync(cli)) {
          try {
            spawnSync(cli, [text], { timeout: 5000, stdio: "ignore" })
          } catch {
            /* doorbell is best effort */
          }
        }
      })
    notify(message)
    delivery = "doorbell"
    const rang =
      port.notify !== undefined ||
      (process.env.AGENTIC_OS_NOTIFY !== "0" && existsSync(join(homedir(), ".local", "bin", "notify")))
    if (!rang) delivery = "queued"
  }
  job.woke = { at, message, delivery, ...(to ? { to } : {}) }
  saveJob(job)
  appendEvent(job.sid, {
    actor: "rail",
    kind: "job.woke",
    jid: job.id,
    message,
    report: where,
    delivery,
    ...(to ? { to } : {}),
  })
  return job
}

// The panes that could hold a spawner's host session: live records of
// running Jobs (a finished Job retires its panes; a died record is
// not live). The waking Job itself never holds its own levy.
export function findLivePaneForSpawner(
  sessionId: string,
  exceptJid?: string,
): { label: string; jid: string } | null {
  for (const other of listJobs()) {
    if (other.id === exceptJid || other.state !== "running") continue
    for (const pane of other.panes) {
      if (pane.died === undefined && pane.transcript?.session_id === sessionId) {
        return { label: pane.label, jid: other.id }
      }
    }
  }
  return null
}

// Booked wait (ADR 0006): the host sessions that running Jobs name as
// their spawner. A pane whose booked session is in this set is idle
// for a reason — its child spur holds the ball — so the rails stand
// down their stall and nudge clocks while the child runs.
export function liveSpawnerSessionIds(): Set<string> {
  const ids = new Set<string>()
  for (const job of listJobs()) {
    if (job.state === "running" && job.spawner) ids.add(job.spawner.session_id)
  }
  return ids
}

export function finishJob(job: JobRecord, receipt: Omit<Receipt, "finished">): JobRecord {
  job.state = "retired"
  job.finished = new Date().toISOString()
  job.receipt = { ...receipt, finished: job.finished }
  saveJob(job)
  appendEvent(job.sid, { actor: "orchestrator", kind: "job.retired", jid: job.id, receipt: job.receipt })
  // the wake names the true outcome — a failed job must not arrive
  // saying "done" (the spawner would read the all-clear and move on)
  wakeFirstMate(job, receipt.status === "failed" ? "failed" : "done", job.receipt.report ?? null)
  return job
}

export function abortJob(
  job: JobRecord,
  reason: string,
  panesRemaining: number,
  actor: string = "sweep",
): JobRecord {
  job.state = "aborted"
  job.finished = new Date().toISOString()
  job.abort = { reason, panesRemaining, finished: job.finished }
  saveJob(job)
  appendEvent(job.sid, { actor, kind: "job.aborted", jid: job.id, reason, panesRemaining })
  wakeFirstMate(job, `aborted (${reason})`, null)
  return job
}

// A dead orchestrator parks the Job in the ask-first queue: sweep
// detects (running + dead pid), the user decides (continue or abort).
// Graceful stops never orphan — pause drains on purpose, and the
// signal handler aborts on purpose.
export function orphanJob(job: JobRecord, reason: string, panesRemaining: number): JobRecord {
  if (job.state !== "running") return job
  const at = new Date().toISOString()
  job.state = "orphaned"
  job.orphan = { reason, panesRemaining, at }
  saveJob(job)
  appendEvent(job.sid, { actor: "sweep", kind: "job.orphaned", jid: job.id, reason, panesRemaining })
  wakeFirstMate(job, `orphaned (${reason}) — continue or abort it`, null)
  return job
}

// Pause parks a drained Job (ADR 5): panes retired, finished units stay
// finished, in-flight units stay open for a resumed session. Not a
// finish — no receipt.
export function pauseJob(job: JobRecord, reason: string, panesRemaining: number): JobRecord {
  job.state = "paused"
  job.finished = undefined
  job.pause = { reason, panesRemaining, at: new Date().toISOString() }
  saveJob(job)
  appendEvent(job.sid, { actor: "orchestrator", kind: "job.paused", jid: job.id, reason, panesRemaining })
  return job
}

// Continue is user-decided, never automatic, and never hard-capped —
// the counter is a soft warning in `jobs`, not a gate (the relaunch
// cap guarded crash-loops; a typed continue is deliberate).
export function continueJob(job: JobRecord, pid: number): JobRecord {
  job.state = "running"
  job.continues = (job.continues ?? 0) + 1
  job.pause = undefined
  job.abort = undefined
  job.orphan = undefined
  job.finished = undefined
  job.pid = pid
  saveJob(job)
  appendEvent(job.sid, {
    actor: "levy",
    kind: "job.continued",
    jid: job.id,
    pid,
    continues: job.continues,
  })
  return job
}

// The session id is booked the moment the host tool reports it —
// write-ahead, so even a SIGKILLed orchestrator leaves a resumable pane.
export function setPaneSession(job: JobRecord, label: string, sessionId: string): JobRecord {
  const pane = job.panes.find((p) => p.label === label)
  if (!pane?.transcript || pane.transcript.session_id === sessionId) return job
  pane.transcript.session_id = sessionId
  saveJob(job)
  appendEvent(job.sid, { actor: "orchestrator", kind: "pane.session", jid: job.id, label, session_id: sessionId })
  return job
}

// Rebuild a Job record purely from the event log — proves the log is the
// source and the record is a projection.
export function projectJob(sid: string, jid: string): JobRecord | null {
  const events = readEvents(sid).filter((e) => e.jid === jid)
  if (events.length === 0) return null
  const born = events.find((e) => e.kind === "job.born")
  if (!born) return null
  const job: JobRecord = {
    id: jid,
    sid,
    stoodUpBy: (born.actor as StoodUpBy) ?? "standalone",
    workflow: "fan-out",
    task: String(born.task ?? ""),
    dir: String(born.dir ?? ""),
    dag: born.dag as DagIdentity | undefined,
    state: "running",
    created: born.ts,
    panes: [],
  }
  for (const e of events) {
    if (e.kind === "pane.born") {
      job.panes.push({
        label: String(e.label),
        pane: e.pane as string | undefined,
        unit: e.unit as string | undefined,
        parent: e.parent as Parent | undefined,
        transcript: e.transcript as TranscriptPointer | undefined,
        seed: e.seed as SeedPointer | undefined,
        born: e.ts,
      })
    } else if (e.kind === "pane.died") {
      const pane = job.panes.find((p) => p.label === e.label)
      if (pane) pane.died = e.ts
    } else if (e.kind === "pane.session") {
      const pane = job.panes.find((p) => p.label === e.label)
      if (pane?.transcript) pane.transcript.session_id = String(e.session_id)
    } else if (e.kind === "job.paused") {
      job.state = "paused"
      job.finished = undefined
      job.pause = {
        reason: String(e.reason ?? ""),
        panesRemaining: Number(e.panesRemaining ?? 0),
        at: e.ts,
      }
    } else if (e.kind === "job.continued") {
      job.state = "running"
      job.continues = Number(e.continues ?? (job.continues ?? 0) + 1)
      job.pause = undefined
      job.abort = undefined
      job.orphan = undefined
      job.finished = undefined
      job.pid = e.pid as number | undefined
    } else if (e.kind === "job.retired") {
      job.state = "retired"
      job.finished = e.ts
      job.receipt = e.receipt as Receipt
    } else if (e.kind === "job.aborted") {
      job.state = "aborted"
      job.finished = e.ts
      job.abort = {
        reason: String(e.reason ?? ""),
        panesRemaining: Number(e.panesRemaining ?? 0),
        finished: e.ts,
      }
    } else if (e.kind === "job.orphaned") {
      job.state = "orphaned"
      job.orphan = {
        reason: String(e.reason ?? ""),
        panesRemaining: Number(e.panesRemaining ?? 0),
        at: e.ts,
      }
    } else if (e.kind === "wake.consumed") {
      job.consumed = { at: e.ts, via: "fork", label: String(e.label ?? "") }
    } else if (e.kind === "job.relaunched") {
      // historical: relaunch was absorbed into continue (ADR 5, M3) —
      // old traces still replay
      job.state = "running"
      job.relaunches = Number(e.relaunches ?? (job.relaunches ?? 0) + 1)
      job.orphan = undefined
      job.finished = undefined
      job.pid = e.pid as number | undefined
    }
  }
  return job
}

export function listJobs(sid?: string): JobRecord[] {
  if (!existsSync(sessionsRoot())) return []
  const sessions = sid
    ? [sid]
    : readdirSync(sessionsRoot(), { withFileTypes: true })
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
  return jobs.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
}

export function findJobByDir(dir: string): JobRecord | null {
  return listJobs().find((job) => job.dir === dir) ?? null
}

// Materialize a run directory for a job: task.txt, a workflow.toml
// snapshot, and the hooks it references copied alongside — self-contained.
export function materializeRunDir(
  runDir: string,
  task: string,
  manifestPath: string,
): { taskPath: string; manifestPath: string } {
  mkdirSync(runDir, { recursive: true })
  const taskPath = join(runDir, "task.txt")
  writeFileSync(taskPath, `${task}\n`)
  const snapshot = join(runDir, "workflow.toml")
  cpSync(manifestPath, snapshot)
  const source = join(manifestPath, "..")
  const hooksSrc = join(source, "hooks")
  if (existsSync(hooksSrc)) cpSync(hooksSrc, join(runDir, "hooks"), { recursive: true })
  writeWorkerPermissions(runDir)
  return { taskPath, manifestPath: snapshot }
}

// Workers start in a unit dir; opencode's external-directory boundary is
// its startup cwd, so touching anything outside the unit prompts every
// time. A per-run opencode.json (project config, discovered by walking
// up from cwd) allows exactly this run's tree — scoped, no global edit.
// Two spellings: the given path (what briefs quote) AND its realpath
// (what opencode canonicalizes its project root to). On /tmp-style
// symlinked roots the two differ and a one-form glob leaks prompts.
export function modelIn(dir: string): string | undefined {
  try {
    return loadManifest(dir).workflow.model
  } catch {
    return undefined
  }
}

export function splitModel(model: string): { provider: string; id: string } {
  const slash = model.indexOf("/")
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) }
}

export function writePiSettings(dir: string, model: string): void {
  const { provider, id } = splitModel(model)
  mkdirSync(join(dir, ".pi"), { recursive: true })
  writeFileSync(
    join(dir, ".pi", "settings.json"),
    `${JSON.stringify({ defaultProvider: provider, defaultModel: id }, null, 2)}\n`,
  )
}

// Grant one more root to a live worker's permission file — durable for
// the next session start; the current dialog is cleared by the rail.
export function addWorkerRoot(runDir: string, root: string): void {
  try {
    const cfgPath = join(runDir, "opencode.json")
    const cfg = existsSync(cfgPath)
      ? (JSON.parse(readFileSync(cfgPath, "utf8")) as { permission?: { external_directory?: Record<string, string> } })
      : {}
    cfg.permission ??= {}
    cfg.permission.external_directory ??= { "*": "ask" }
    for (const form of new Set([root, realpathSync(root)])) {
      cfg.permission.external_directory[form] = "allow"
      cfg.permission.external_directory[`${form}/**`] = "allow"
    }
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
  } catch {
    // permissions are best-effort; the dialog decision still applies
  }
}

export function writeWorkerPermissions(runDir: string, extraRoots: string[] = []): void {
  try {
    const real = realpathSync(runDir)
    const external = { "*": "ask" } as Record<string, string>
    const roots = [runDir, real, ...extraRoots]
    for (const root of roots) {
      try {
        const forms = new Set([root, realpathSync(root)])
        for (const form of forms) external[`${form}/**`] = "allow"
      } catch {
        external[`${root}/**`] = "allow"
      }
    }
    const config: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      permission: { external_directory: external },
    }
    const model = modelIn(runDir)
    if (model) config.model = model
    writeFileSync(join(runDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`)
  } catch {
    // permissions scoping is best-effort; the run works without it
  }
}
