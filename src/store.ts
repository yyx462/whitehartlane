// The OS disk (zen 2): ~/.local/share/whitehartlane (AGENTIC_OS_HOME;
// a legacy ~/.local/share/agentic-os disk is honored — ADR 0011).
// sessions/<sid>/ holds the session record (with its host binding — a
// pointer, never a copy), events.jsonl (THE trace: append-only, one
// line per fact), and jobs/<jid>/{job.json,run/}. job.json is a
// projection of events; records are never deleted (zen 5: retired is a
// state, not rm).
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { loadManifest } from "./hooks.ts"
import { TEMP_ROOTS } from "./permission.ts"
import { appendSpoolWake, spoolAlive } from "./wake-spool.ts"
import { forkLevy } from "./fork.ts"
import { backoffBase, backoffMs, retries, sleepSync } from "./backoff.ts"
import { opencodeSessionTitle } from "./transcripts.ts"
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

// Spur identity (ADR 0009): the group a run belongs to. project is a
// minted pid (project.json in the program folder); spur_id is unique
// inside it; content_hash versions the staged program; branch/worktree
// are labels.
export type SpurIdentity = {
  project: string
  project_name: string
  spur_id: string
  content_hash: string
  source: string
  labels?: Record<string, string>
}

// ADR 0009: records on the OS disk written before the rename spell the
// identity block `dag` with a `dag_id` key — read both spellings,
// always answer the new one. Nothing old is rewritten; nothing new is
// written in the old spelling.
export function normalizeSpur(raw: unknown): SpurIdentity | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const spurId = typeof r.spur_id === "string" && r.spur_id ? r.spur_id : typeof r.dag_id === "string" && r.dag_id ? r.dag_id : null
  if (!spurId) return null
  return {
    project: String(r.project ?? ""),
    project_name: String(r.project_name ?? ""),
    spur_id: spurId,
    content_hash: String(r.content_hash ?? ""),
    source: String(r.source ?? ""),
    ...(r.labels && typeof r.labels === "object" ? { labels: r.labels as Record<string, string> } : {}),
  }
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
  // Issue #123 — the lease: leadership over a Job is a written,
  // expiring claim in job.json, not whoever happens to be running.
  // The orchestrator acquires at open (epoch bumps on every claim) and
  // renews on its engine beat; expiry is STICKY — death needs no
  // message, absence of renewal is the signal. Absent on pre-lease
  // jobs (back-compat).
  lease?: { holder: string; epoch: number; renewed: string; expires: string }
  repo?: string
  worktree?: string
  spur?: SpurIdentity
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
  woke?: { at: string; message: string; delivery?: WakeDelivery; to?: string; rungs?: WakeRung[] }
  promoted?: { at: string; note: string }
  // ADR 0006 §3 — a fork delivered the booked wake into a reborn levy
  // pane; the wake is consumed, not re-delivered.
  consumed?: { at: string; via: "fork"; label: string; pane?: string }
}

// ADR 0006: the levy — the main agent that stood the Job up, booked at spawn.
// `since` is the checkpoint — a point in the FM's own transcript, never
// a copy. A whl fork reborn points back here and nowhere else. `pane`
// is the spawn-time pane binding (HERDR_PANE_ID when the door runs
// inside herdr): the one delivery address the wake can check without
// any registry — booked at the exact moment session and pane are both
// known, immutable for this Job's life.
export type SpawnerPointer = {
  tool: string
  session_id: string
  since: string
  pane?: string
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
  if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
  // ADR 0011: the disk default is ~/.local/share/whitehartlane; a legacy
  // agentic-os disk still wins while it is the only one that exists
  // (read both, write the new spelling — the ADR 0009 pattern).
  const next = join(homedir(), ".local", "share", "whitehartlane")
  const old = join(homedir(), ".local", "share", "agentic-os")
  return existsSync(old) && !existsSync(next) ? old : next
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
  spur?: SpurIdentity
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
    spur: input.spur,
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
    ...(job.spur ? { spur: job.spur } : {}),
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

// ADR 0006 + 0008 — the end-of-job wake: exactly one message to the
// levy that stood the Job up ("spur for task X done — report at …").
// Layered delivery: wake.json on the job dir (durable), one job.woke
// trace event, `woke` on the record as the once-guard, then the
// ladder, best-first: (1) the PARENT PANE — the pane booked on the
// spawner record at handover (HERDR_PANE_ID at spawn, or --pane),
// prompted in-band when live and titled like the session; (2) the
// FORK — the parent is dead, so the wake rebirths the session into a
// fresh pane (AGENTIC_OS_FORK_WAKE=0 disarms); (3) the spool —
// config-off plugin territory (AGENTIC_OS_SPOOL_WAKE=1 arms), reached
// only when the fork could not; (4) the machine's notify CLI doorbell
// (best-effort; AGENTIC_OS_NOTIFY=0 or absence disables); the durable
// record waits ("queued") for `whl fork`. No spawner -> no wake (the
// Job is unattended, nothing to tell). The 2026-10-13 simplification
// removed the worker-pane scan and the manual registry rungs — the
// spawn-time parent pane does their one job with a better source of
// truth; the registry survives only as audit bookkeeping.
export type WakeDelivery = "pane" | "fork" | "inband" | "doorbell" | "queued"

// One rung attempt, recorded however it went — taken, refused, or
// skipped and why. A doorbell wake must never again be a mystery: the
// 2026-10-12 p10 batch fell to rung 5 with no record of why rungs 1-4
// refused (the missing registration, the fork's why, the absent
// heartbeat were all invisible after the fact).
export type WakeRung = { rung: string; ok: boolean; why?: string }

export type WakePort = {
  // prompt a live pane (herdr agent prompt <label>); false = not live
  promptPane?: (label: string, message: string) => boolean
  // what lives in a pane right now (herdr agent list): alive, and the
  // terminal title — the identity guard for the spawn-time parent pane
  paneInfo?: (pane: string) => { alive: boolean; title?: string } | null
  // the wake-time rebirth (rung 2) — armed by the caller or the default
  forkLevy?: (job: JobRecord, wake: { message: string }) => { ok: boolean; label?: string; pane?: string; why?: string }
  // the doorbell fallback (notify CLI)
  notify?: (message: string) => void
}

// The parent pane's identity guard (the spawn-time rung): herdr cannot
// name the session a pane hosts, but the host tool syncs the session's
// title into the pane's terminal title (opencode: "OC | <title>"). A
// live pane whose title still matches the spawner session's current
// title is the same conversation; a mismatch is a recycled pane —
// prompt it and the wake lands in a stranger's chat. null = cannot
// judge (either title unknown): the prompt itself is then the oracle.
// Terminal titles truncate with a trailing ellipsis — a truncated
// prefix is still a match.
export function paneTitlesSession(paneTitle: string | undefined, sessionTitle: string | null): boolean | null {
  if (!paneTitle || !sessionTitle) return null
  const stripped = paneTitle.replace(/^[^|]+\|\s*/, "")
  if (stripped.endsWith("…") || stripped.endsWith("...")) {
    return sessionTitle.startsWith(stripped.replace(/(\u2026|\.\.\.)$/, ""))
  }
  return stripped === sessionTitle
}

// the fork rung is armed in production, disarmed under node:test
// (herdr side effects in unit tests are never wanted) and by an
// explicit escape hatch for herdr-less hosts
function forkArmed(): boolean {
  return process.env.AGENTIC_OS_FORK_WAKE !== "0" && !process.env.NODE_TEST_CONTEXT
}

// The spool rung is config-OFF by default (the 2026-10-13 call): the
// reader is an opt-in plugin and was never installed on this machine,
// so the ladder must not pretend the channel exists. Arm it with
// AGENTIC_OS_SPOOL_WAKE=1 once `whl plugin install` has run and
// opencode has restarted; until then the trace says why it is skipped.
function spoolArmed(): boolean {
  return process.env.AGENTIC_OS_SPOOL_WAKE === "1"
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
  // the rung trace: every attempt — taken, refused, skipped — lands on
  // the woke record, the session trail, and the job's orchestrator.log,
  // so a doorbell wake explains itself after the fact
  const rungs: WakeRung[] = []
  const step = (rung: string, ok: boolean, why?: string) => {
    rungs.push({ rung, ok, ...(why ? { why } : {}) })
    appendEvent(job.sid, { actor: "rail", kind: "wake.rung", jid: job.id, rung, ok, ...(why ? { why } : {}) })
    try {
      mkdirSync(job.dir, { recursive: true })
      appendFileSync(join(job.dir, "orchestrator.log"), `${new Date().toISOString()} wake rung ${rung} ${ok ? "ok" : "no"}${why ? ` — ${why}` : ""}\n`)
    } catch {
      /* the trace event above still books the step */
    }
  }
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
  const prompt = (label: string): boolean => (promptPane ? promptPane(label, `[wake] ${message}`) : false)
  if (railSpawner) {
    step("in-band", false, "rail spawner — in-band rungs skipped; wake.json is the receipt")
  }
  // rungs 1-4 live in one chain: parent pane, rebirth, spool, doorbell.
  // (2026-10-13 simplification: the worker-pane scan and the manual
  // registry rungs are gone — the spawn-time parent pane does their one
  // job with a better source of truth, and the registry survives only
  // as audit bookkeeping for legitimately-live unbooked panes.)
  if (delivery === "queued" && !railSpawner) {
    let paneTook = false
    // rung 1 — the parent pane (booked at spawn): the levy handed the
    // spur over from INSIDE a herdr pane, and the door booked that pane
    // on the spawner record (--pane or HERDR_PANE_ID) — the strongest
    // address the wake holds, no registry involved. herdr cannot name
    // the session a pane hosts, so the terminal title is the identity
    // guard: the host tool syncs the session's title into the pane's
    // terminal ("OC | <title>"); a live pane that stopped matching is a
    // recycled pane, not the levy — fall through, never misdeliver.
    const paneInfo = port.paneInfo ??
      ((pane) => {
        try {
          const out = spawnSync("herdr", ["agent", "list"], { timeout: 10_000, encoding: "utf8" })
          const agents = (JSON.parse(out.stdout)?.result?.agents ?? []) as { pane_id?: string; terminal_title?: string }[]
          const hit = agents.find((a) => a.pane_id === pane)
          return hit ? { alive: true, title: hit.terminal_title } : { alive: false }
        } catch {
          return null // herdr unreachable — the prompt itself is the oracle
        }
      })
    const parentPane = job.spawner.pane
    if (!parentPane) {
      step("parent-pane", false, "no parent pane booked at spawn — whl run ran outside herdr, or pre-dates pane capture")
    } else {
      const info = paneInfo(parentPane)
      const sessionTitle = job.spawner.tool === "opencode" ? opencodeSessionTitle(job.spawner.session_id) : null
      const titled = paneTitlesSession(info?.title, sessionTitle)
      if (info && !info.alive) {
        step("parent-pane", false, `parent pane ${parentPane} (booked at spawn) is not alive`)
      } else if (titled === false) {
        step(
          "parent-pane",
          false,
          `parent pane ${parentPane} is alive but no longer hosts this session (terminal ${JSON.stringify(info?.title)} vs session ${JSON.stringify(sessionTitle)}) — a recycled pane, not the levy`,
        )
      } else if (prompt(parentPane)) {
        delivery = "pane"
        to = parentPane
        paneTook = true
        step("parent-pane", true, `prompted parent pane ${parentPane} (booked at spawn)${titled === true ? " — terminal title matches the session" : ""}`)
      } else {
        step("parent-pane", false, `parent pane ${parentPane} is alive but did not take the prompt`)
      }
    }
    // rung 2 — the fork: the parent pane is dead, not booked, or
    // recycled (ADR 0008). The wake rebirths the levy into a fresh
    // pane — session resumed from the checkpoint, wake as the first
    // prompt. An injected port always runs (tests); the default is
    // armed in production only — disarmed under node:test and by
    // AGENTIC_OS_FORK_WAKE=0 (herdr-less hosts).
    if (!paneTook && (port.forkLevy ?? forkArmed())) {
      // the brownout guard's wake half (ADR 0010): a refused fork is
      // not final — herdr may be brown at exactly this moment. Knock
      // again with growing pauses; every retry lands in the rung
      // trace. AGENTIC_OS_FORK_TRIES / _BACKOFF_MS tune it (tests
      // inject their own scale; a single attempt never pauses).
      const forkFn = port.forkLevy ?? ((j: JobRecord, w: { message: string }) => forkLevy(j, w))
      const tries = retries("AGENTIC_OS_FORK_TRIES", 3)
      const baseMs = backoffBase("AGENTIC_OS_FORK_BACKOFF_MS", 5_000)
      let forked = forkFn(job, { message })
      for (let attempt = 1; attempt < tries && !forked.ok; attempt++) {
        const pause = backoffMs(baseMs, attempt)
        step("fork", false, `refused: ${forked.why ?? "no reason"} — brownout retry ${attempt}/${tries - 1} in ${pause}ms`)
        sleepSync(pause)
        forked = forkFn(job, { message })
      }
      if (forked.ok) {
        delivery = "fork"
        to = forked.label
        step("fork", true, `rebirthed the levy at pane ${forked.pane ?? "?"} (${forked.label})`)
        job.consumed = { at: new Date().toISOString(), via: "fork", label: forked.label, pane: forked.pane }
        appendEvent(job.sid, {
          actor: "rail",
          kind: "wake.consumed",
          jid: job.id,
          via: "fork",
          label: forked.label,
        })
      } else {
        step("fork", false, `fork refused: ${forked.why}`)
      }
    } else if (!paneTook) {
      step(
        "fork",
        false,
        process.env.AGENTIC_OS_FORK_WAKE === "0"
          ? "disarmed by AGENTIC_OS_FORK_WAKE=0"
          : "disarmed (test context — NODE_TEST_CONTEXT is set)",
      )
    }
    // rung 3 — the spool: config-gated plugin territory (the levy
    // installed the agentic-wake reader itself), then heartbeat-gated.
    // Only reached when the fork could not take the wake — a fresh
    // heartbeat never outranks it. Off by default: the reader is not
    // installed on this machine.
    if (delivery === "queued") {
      if (!spoolArmed()) {
        step("spool", false, "off by config — AGENTIC_OS_SPOOL_WAKE=1 arms it (after whl plugin install)")
      } else if (job.spawner.tool !== "opencode") {
        step("spool", false, `opencode-only rung; this spawner is ${job.spawner.tool}`)
      } else if (!spoolAlive(job.spawner.session_id)) {
        step("spool", false, `no fresh heartbeat for session ${job.spawner.session_id} (alive.json stale or absent)`)
      } else if (appendSpoolWake({ at, to: job.spawner.session_id, jid: job.id, text: message })) {
        delivery = "inband"
        to = job.spawner.session_id
        step("spool", true, "row queued in-band; the plugin drains it into the conversation")
      } else {
        step("spool", false, "queue append failed (fs error)")
      }
    }
  }
  // rung 4 — the doorbell: the levy is a chat a person holds, or no
  // rung above could take the wake. A rail spawner skips it: machines
  // are not doorbelled.
  if (delivery !== "pane" && delivery !== "fork" && delivery !== "inband" && !railSpawner) {
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
    step(
      "doorbell",
      rang,
      rang
        ? "notify CLI rang (best effort — the human's phone, not the levy)"
        : "no notify CLI on this host (or AGENTIC_OS_NOTIFY=0) — the durable wake.json waits as queued",
    )
  }
  job.woke = { at, message, delivery, rungs, ...(to ? { to } : {}) }
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

// The fail button (test entry): mark a Job failed on demand and fire
// the wake ladder — a deterministic repro for the wake path that needs
// no real failing run. Never touches a running Job (abort owns live
// jobs); an already-woke Job re-fires only with again (the once-guard
// otherwise holds). A real report.json is never clobbered — one is
// minted only when none exists.
export function failJob(
  job: JobRecord,
  reason: string,
  opts: { again?: boolean; port?: WakePort } = {},
): JobRecord | null {
  if (job.state === "running") return null
  if (job.woke && !opts.again) return null
  const at = new Date().toISOString()
  job.state = "retired"
  job.finished = at
  let report = job.receipt?.report ?? join(job.dir, "report.json")
  if (!existsSync(report)) {
    report = join(job.dir, "report.json")
    try {
      mkdirSync(job.dir, { recursive: true })
      writeFileSync(
        report,
        JSON.stringify({ kind: "report", status: "failed", table: [{ unit: "fail-button", result: reason }], where: job.dir }, null, 2) + "\n",
      )
    } catch {
      /* the wake still fires; the outcome text carries the reason */
    }
  }
  const live = job.panes.filter((p) => p.died === undefined).length
  job.receipt = {
    panesRemaining: live,
    panesTotal: job.panes.length,
    unitsDone: Number.NaN,
    unitsFailed: Number.NaN,
    status: "failed",
    report,
    finished: at,
  }
  if (opts.again) job.woke = undefined
  saveJob(job)
  appendEvent(job.sid, { actor: "levy", kind: "job.fail-button", jid: job.id, reason, again: Boolean(opts.again) })
  wakeFirstMate(job, `failed (fail-button: ${reason})`, report, opts.port)
  return job
}

// A dead orchestrator parks the Job in the ask-first queue: sweep
// detects (running + dead pid), the user decides (continue or abort).
// Graceful stops never orphan — pause drains on purpose, and the
// signal handler aborts on purpose.
// Issue #123 — lease lifecycle. LEASE_TTL is the renewal window, not a
// death sentence: the sweep's robust oracle is the holder pid; pure
// lease-expiry action stays opt-in (AGENTIC_OS_LEASE_ENFORCE=1) until
// beat density is proven across quiet fan-out waits. A wedged-but-alive
// orchestrator (pid alive, lease long expired) is the case the lease
// exists for — timers grant the right to suspect, the census decides.
export const LEASE_TTL_MS = 5 * 60_000

export function acquireLease(job: JobRecord, holder: string): void {
  const epoch = (job.lease?.epoch ?? 0) + 1
  job.lease = {
    holder,
    epoch,
    renewed: new Date().toISOString(),
    expires: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
  }
  saveJob(job)
  appendEvent(job.sid, { actor: "orchestrator", kind: "lease.acquired", jid: job.id, epoch, holder })
}

// Renewal is best-effort and cheap (one fs write per engine beat): the
// lease record must never break the run it observes.
export function renewLeaseOf(job: JobRecord): void {
  if (!job.lease) return
  job.lease.renewed = new Date().toISOString()
  job.lease.expires = new Date(Date.now() + LEASE_TTL_MS).toISOString()
  try {
    saveJob(job)
  } catch {}
}

// Expired past its TTL plus a grace period (one missed beat under load
// is noise, not death).
export function leaseExpired(job: JobRecord, graceMs = LEASE_TTL_MS): boolean {
  if (!job.lease?.expires) return false
  return Date.now() > Date.parse(job.lease.expires) + graceMs
}

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
    spur: normalizeSpur(born.spur ?? born.dag),
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

// ADR 0010 — the doorbell is a last resort, never a silent one: the
// wake audit names every job whose wake fell out of band (doorbell or
// queued, never consumed), so a brownout's leftovers surface on the
// next `whl audit` instead of rotting in job.json. The fork rung's
// why is the diagnosis (it is the rung that was supposed to work).
//
// Issue #124 — a fork-booked wake was invisible here: consumed was
// booked on courier birth, so a wake whose prompt never reached a live
// turn (the reaper race: "idle" before first work) audited as
// delivered. The courier now writes a receipt — worked:true/false —
// and the audit surfaces a never-worked courier for a re-drain.
export type WakeAuditRow = { jid: string; task: string; at: string; delivery: string; why: string }

export function wakeAudit(jobs: JobRecord[]): WakeAuditRow[] {
  return jobs
    .filter((j): j is JobRecord & { woke: NonNullable<JobRecord["woke"]> } => {
      if (!j.woke) return false
      if (!j.consumed && (j.woke.delivery === "doorbell" || j.woke.delivery === "queued")) return true
      if (j.woke.delivery === "fork" && courierNeverWorked(j)) return true
      return false
    })
    .sort((a, b) => b.woke.at.localeCompare(a.woke.at))
    .map((j) => ({
      jid: j.id,
      task: j.task,
      at: j.woke.at,
      delivery: j.woke.delivery,
      why:
        j.woke.delivery === "fork"
          ? "courier pane closed without ever working — the wake prompt never reached a live turn; drain it again"
          : j.woke.rungs?.filter((r) => r.rung === "fork").at(-1)?.why ??
            j.woke.rungs?.filter((r) => !r.ok).at(-1)?.why ??
            j.woke.message,
    }))
}

// The courier receipt (issue #124): forkLevy's reaper writes
// courier.json {worked: boolean} beside the job. Absent (pre-fix runs
// or no fork) means unknown, not failed — the audit never guesses.
function courierNeverWorked(job: JobRecord): boolean {
  if (!job.dir) return false
  try {
    const receipt = JSON.parse(readFileSync(join(job.dir, "courier.json"), "utf8")) as { worked?: unknown }
    return receipt?.worked === false
  } catch {
    return false
  }
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

// opencode's CLI dropped --model from the root command (2026-10
// upgrade), so a worker's model — workflow-level or the per-member
// override — rides the config layer instead: the sandbox opencode.json
// the worker discovers from its startup cwd. Read-modify-write:
// writeWorkerPermissions has usually already shaped this file.
export function writeOpencodeModel(dir: string, model: string): void {
  try {
    const cfgPath = join(dir, "opencode.json")
    const cfg = existsSync(cfgPath)
      ? (JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>)
      : {}
    cfg.$schema ??= "https://opencode.ai/config.json"
    cfg.model = model
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
  } catch {
    // model pinning is best-effort; the global default still applies
  }
}

// Grant one more root to a live worker's permission file — durable for
// the next session start; the current dialog is cleared by the rail.
// A degenerate root ("/", "") is refused: one temp allow must never
// whitelist the whole disk for the next session (j-b6067c granted
// "/**" by parent-stripping /tmp).
export function addWorkerRoot(runDir: string, root: string): void {
  if (root === "" || root === "/") return
  try {
    const cfgPath = join(runDir, "opencode.json")
    const cfg = existsSync(cfgPath)
      ? (JSON.parse(readFileSync(cfgPath, "utf8")) as { permission?: { external_directory?: Record<string, string> } })
      : {}
    cfg.permission ??= {}
    cfg.permission.external_directory ??= { "*": "ask" }
    for (const form of new Set([root, realpathSync(root)])) {
      if (form === "" || form === "/") continue
      cfg.permission.external_directory[form] = "allow"
      cfg.permission.external_directory[`${form}/**`] = "allow"
    }
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
  } catch {
    // permissions are best-effort; the dialog decision still applies
  }
}

// Temp scratch is pre-seeded, not re-allowed beat after beat (j-b6067c:
// five /tmp dialogs, one per 30s beat). The rail already treats temp as
// no boundary (permission.ts TEMP_ROOTS) — the worker's own config says
// so from session start, so a mktemp/git/pip write never prompts.
export function writeWorkerPermissions(runDir: string, extraRoots: string[] = []): void {
  try {
    const real = realpathSync(runDir)
    const external = { "*": "ask" } as Record<string, string>
    const roots = [runDir, real, ...TEMP_ROOTS, ...extraRoots]
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
