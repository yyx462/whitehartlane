// The Rail (zen 2/5/6): one home for the machinery every orchestrator
// uses and none may rewrite — the Job ledger, pane bookkeeping, layout,
// session booking, and the permission half of JEV. The three rails
// (fan-out, lab, coworker) construct one Rail and drive it with their
// engine; the Rail implements ShepPort, so engines that speak the port
// (src/orchestrator.ts) take the rail directly.
//
// Migration seam: engines address workers by NAME (spawnWorker(name),
// paneAlive(name)) — nothing pane-shaped leaks past this class. Every
// shep/herdr invocation funnels through the runner seam (src/runners.ts)
// injected below. If panes become remote machines tomorrow, the swap
// happens there, in one file; engines and bins do not change.
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { loadManifest, type Layout, type Manifest } from "./hooks.ts"
import { drop, note, place, type Board } from "./lanes.ts"
import { paneLabeler, runIdFor, type ShepPort } from "./orchestrator.ts"
import { decidePermission, escalateOnRepeat, PERMISSION_CAP, tunedPermissionJudge, type PermissionJudge } from "./permission.ts"
import type { Report } from "./report.ts"
import {
  abortJob as abortJobRec,
  addWorkerRoot,
  appendEvent,
  attachPane,
  createJob,
  finishJob as finishJobRec,
  jobRunDir,
  killPane,
  loadJob,
  modelIn,
  openSession,
  pauseJob as pauseJobRec,
  readEvents,
  saveJob,
  setPaneSession,
  splitModel,
  writePiSettings,
  writeWorkerPermissions,
  type JobRecord,
  type Receipt,
  type SeedPointer,
  type TranscriptPointer,
} from "./store.ts"
import { readState } from "./state.ts"
import { resolveOpencode, resolvePi } from "./transcripts.ts"
import { defaultRunner, jsonAt, type RunnerResult } from "./runners.ts"
import { beat, note as sayOnce, verboseOn } from "./verbose.ts"

export type { RunnerResult } from "./runners.ts"

// The Job ledger surface the Rail needs (zen 2/5). Bookkeeping must
// never break the rail: every call is best-effort, and a run without
// a record still runs. Events are the trace; job.json is the store's
// projection. Injectable so tests run without the OS disk.
export type RailLedger = {
  job: JobRecord
  emit: (kind: string, payload: Record<string, unknown>) => void
  attach: (
    label: string,
    pane: string | undefined,
    unit: string | undefined,
    transcript?: TranscriptPointer,
    seed?: SeedPointer,
  ) => void
  kill: (label: string) => void
  finish: (receipt: Omit<Receipt, "finished">) => void
  abort: (reason: string, panesRemaining: number) => void
  pause: (reason: string, panesRemaining: number) => void
  setSession: (label: string, sessionId: string) => void
}

export type RailOpts = {
  // argv[2] of the bin, or null for a standalone self-opened run
  argvDir?: string | null
  // workflow name stamped on a self-opened Job ("fan-out", "lab", "coworker")
  workflow?: string
  log?: (msg: string) => void
  workerModel?: string
  // extra roots a program names for its workers (roots.txt)
  programRoots?: string[]
  // the migration seam (see header): every shep/herdr CLI call goes
  // through these; swap them and the panes become anything
  shepRunner?: (args: string[]) => RunnerResult
  herdrRunner?: (args: string[]) => RunnerResult
  ledger?: RailLedger | null
  judge?: PermissionJudge
}

function taskLine(dir: string): string {
  try {
    return readFileSync(join(dir, "task.txt"), "utf8").split("\n")[0]?.slice(0, 120) || basename(dir)
  } catch {
    return basename(dir)
  }
}

export function waitChange(dir: string, ms: number): Promise<void> {
  return new Promise((res) => {
    let done = false
    let watcher: ReturnType<typeof watch> | null = null
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { watcher?.close() } catch {}
      res()
    }
    const timer = setTimeout(finish, ms)
    try {
      watcher = watch(dir, finish)
    } catch {
      // the timer is the backstop
    }
  })
}

const START_TIMEOUT_MS = 60_000
const WORKER_SHARE = 0.5

export class Rail implements ShepPort {
  readonly taskDir: string
  readonly log: (msg: string) => void
  readonly ledger: RailLedger | null
  readonly programRoots: string[]
  readonly mine = new Set<string>()
  private readonly workerModel: string | undefined
  private readonly shepRun: (args: string[]) => RunnerResult
  private readonly herdrRun: (args: string[]) => RunnerResult
  private readonly judge: PermissionJudge | undefined
  private readonly scopedFn: (name: string) => string
  // per-pane memory the permission sweep derives roots and context from
  private readonly cwdOf = new Map<string, string>()
  private readonly briefOf = new Map<string, string>()
  // fleet tab state (layout tab = "new")
  private layout: { tab: "same" | "new"; orchestrator: "left" | "right" } = { tab: "same", orchestrator: "left" }
  private fleetRoot: string | null = null
  private viewerPane: string | null = null
  private colPane: string | null = null
  private colUsed = false
  private readonly liveWorkerPanes: string[] = []
  private readonly paneOf = new Map<string, string>()
  // verbose lane
  private readonly seen = new Map<string, string>()
  private verbosePath: string | null = null
  private verbosePane: string | null = null
  // the drain hook a SIGTERM-running engine installs (ADR 5): the
  // coworker engine parks on it; a door without one aborts on TERM
  drainHook: (() => void) | null = null
  // permission sweep state (zen 6): asks per pane, asks per pane+path,
  // and verdict notes queued for a pane that could not take them
  private readonly askedCount = new Map<string, number>()
  private readonly pathAsks = new Map<string, number>()
  private readonly pendingNote = new Map<string, string>()

  constructor(opts: RailOpts = {}) {
    this.log = opts.log ?? ((msg) => console.log(`${new Date().toISOString()} ${msg}`))
    this.shepRun = opts.shepRunner ?? defaultRunner("shep")
    this.herdrRun = opts.herdrRunner ?? defaultRunner("herdr")
    this.programRoots = opts.programRoots ?? []
    this.judge = opts.judge
    this.ledger = opts.ledger !== undefined ? opts.ledger : this.openLedger(opts.argvDir ?? null, opts.workflow ?? "fan-out")
    this.taskDir = opts.argvDir ?? this.ledger?.job.dir ?? resolve(process.cwd())
    this.workerModel = opts.workerModel !== undefined ? opts.workerModel : modelIn(this.taskDir)
    this.scopedFn = paneLabeler(runIdFor(this.taskDir))
  }

  // The Job ledger, self-opened when the bin was started standalone
  // (no AGENTIC_OS_SID/JID in the env). Best-effort: a run without a
  // record still runs.
  private openLedger(argvDir: string | null, workflow: string): RailLedger | null {
    try {
      let job: JobRecord | null = null
      const { AGENTIC_OS_SID: sid0, AGENTIC_OS_JID: jid0 } = process.env
      if (sid0 && jid0) job = loadJob(sid0, jid0)
      if (!job) {
        const sess = openSession({ cwd: argvDir ?? process.cwd() })
        job = createJob({
          sid: sess.id,
          stoodUpBy: "standalone",
          workflow,
          task: argvDir ? taskLine(argvDir) : "standalone run",
          dir: argvDir ?? jobRunDir(sess.id, "pending"),
        })
        if (!argvDir) {
          job.dir = jobRunDir(sess.id, job.id)
          job.task = "standalone run"
          saveJob(job)
        }
        this.log(`job ${job.id} self-opened on session ${job.sid} (no AGENTIC_OS_SID/JID passed)`)
      }
      job.pid = process.pid
      saveJob(job)
      const booked = job
      return {
        job: booked,
        emit: (kind, payload) => {
          try {
            appendEvent(booked.sid, { actor: "orchestrator", jid: booked.id, kind, ...payload })
          } catch {}
        },
        attach: (label, pane, unit, transcript, seed) => {
          try {
            attachPane(booked, { label, pane, unit, parent: "orchestrator", transcript, seed })
          } catch {}
        },
        kill: (label) => {
          try {
            killPane(booked, label)
          } catch {}
        },
        finish: (receipt) => {
          try {
            finishJobRec(booked, receipt)
            this.log(`job ${booked.id} retired — receipt: panes remaining ${receipt.panesRemaining}/${booked.panes.length}`)
          } catch (err) {
            this.log(`ledger: finish failed (${err instanceof Error ? err.message : String(err)})`)
          }
        },
        abort: (reason, panesRemaining) => {
          try {
            abortJobRec(booked, reason, panesRemaining)
            this.log(`job ${booked.id} aborted (${reason}) — panes remaining ${panesRemaining}`)
          } catch {}
        },
        pause: (reason, panesRemaining) => {
          try {
            pauseJobRec(booked, reason, panesRemaining)
            this.log(`job ${booked.id} paused (${reason}) — panes remaining ${panesRemaining}`)
          } catch {}
        },
        setSession: (label, sessionId) => {
          try {
            setPaneSession(booked, label, sessionId)
          } catch {}
        },
      }
    } catch (err) {
      this.log(`ledger unavailable (${err instanceof Error ? err.message : String(err)}) — running without a Job record`)
      return null
    }
  }

  // -- helpers the bins reach through -----------------------------------------

  scopedName(name: string): string {
    return this.scopedFn(name)
  }

  writePermissions(dir: string = this.taskDir, extraRoots: string[] = []): void {
    writeWorkerPermissions(dir, extraRoots)
  }

  existingRows(): { unit: string; result: string; pass: boolean }[] | undefined {
    if (!this.ledger) return undefined
    return readEvents(this.ledger.job.sid)
      .filter((e) => e.jid === this.ledger!.job.id && e.kind === "unit.settled")
      .map((e) => ({ unit: String(e.unit), result: String(e.result ?? ""), pass: e.pass === true }))
  }

  // ADR 5: unfinished units of an earlier generation resume from the
  // pane ledger — the latest pane record per unsettled unit carries the
  // booked session pointer (write-ahead at spawn, session id at birth).
  resumesForUnsettled(): Map<string, ResumePointerLike> {
    const resumes = new Map<string, ResumePointerLike>()
    if (!this.ledger) return resumes
    const settled = readState(this.taskDir)
    const closed = new Set([...settled.done, ...settled.failed])
    const latest = new Map<string, PaneRecordLike>()
    for (const p of this.ledger.job.panes) {
      if (!p.unit || !p.transcript) continue
      const prev = latest.get(p.unit)
      if (!prev || p.born > prev.born) latest.set(p.unit, p)
    }
    for (const [unitId, p] of latest) {
      if (closed.has(unitId)) continue
      resumes.set(unitId, {
        tool: p.transcript.tool,
        ...(p.transcript.session_id ? { session_id: p.transcript.session_id } : {}),
        cwd: p.transcript.cwd || this.ledger.job.worktree || this.taskDir,
      })
    }
    return resumes
  }

  liveWorkflow(dir: string = this.taskDir): boolean {
    try {
      const raw = readFileSync(join(dir, "workflow.toml"), "utf8")
      return /^\s*kind\s*=\s*"lab"\s*$/m.test(raw) || /^\s*live\s*=\s*true\s*$/m.test(raw)
    } catch {
      return false
    }
  }

  // The staged manifest, memoized — the run door stages workflow.toml
  // once, so engines re-reading it mid-loop (per grade, per report)
  // parse the same bytes every time. Throws like loadManifest until
  // the first success.
  private manifestCache: Manifest | undefined
  manifest(): Manifest {
    if (!this.manifestCache) this.manifestCache = loadManifest(this.taskDir)
    return this.manifestCache
  }

  // -- private exec shims ------------------------------------------------------

  private shep(...args: string[]): RunnerResult {
    return this.shepRun(args)
  }

  private herdr(...args: string[]): RunnerResult {
    return this.herdrRun(args)
  }

  private agentState(name: string): string {
    return this.herdr("agent", "get", this.scopedFn(name)).stdout
  }

  // -- fleet tab layout --------------------------------------------------------

  private splitPane(fromPane: string, direction: string, cwd: string, ratio: number): string | null {
    const r = this.herdr(
      "pane", "split", "--pane", fromPane, "--direction", direction,
      "--ratio", String(ratio), "--cwd", cwd, "--no-focus",
    )
    return jsonAt(r.stdout, (d) => (d as { result?: { pane?: { pane_id?: string } } }).result?.pane?.pane_id ?? null)
  }

  private openFleetTab(dir: string): void {
    const label = `fan-out-${basename(dir)}`.slice(0, 40)
    const r = this.herdr("tab", "create", "--label", label, "--cwd", dir, "--no-focus")
    const root = jsonAt(r.stdout, (d) => (d as { result?: { root_pane?: { pane_id?: string } } }).result?.root_pane?.pane_id ?? null)
    if (!root) {
      this.log(`fleet tab unavailable (rc=${r.status}) — falling back to same-tab layout`)
      this.layout = { ...this.layout, tab: "same" }
      return
    }
    this.fleetRoot = root
    // The tab root is not a shell. Split a shell, close the root, then
    // split that shell 50-50. The lane and the worker column are both new panes.
    const shell = this.splitPane(root, "right", dir, 0.5)
    if (!shell) {
      this.log("fleet pre-split failed — falling back to same-tab layout")
      this.layout = { ...this.layout, tab: "same" }
      this.fleetRoot = null
      return
    }
    this.herdr("pane", "close", root)
    const side = this.splitPane(shell, "right", dir, WORKER_SHARE)
    if (!side) {
      this.log("fleet pre-split failed — falling back to same-tab layout")
      this.layout = { ...this.layout, tab: "same" }
      this.fleetRoot = null
      return
    }
    if (this.layout.orchestrator === "left") {
      this.viewerPane = shell
      this.colPane = side
    } else {
      this.viewerPane = side
      this.colPane = shell
    }
    this.log(`fleet tab ${label} opened (workers ${WORKER_SHARE} / lane ${1 - WORKER_SHARE})`)
  }

  // Split a pane for the next worker in the fleet tab's column: the
  // column head first, then below the newest live worker, then a fresh
  // column beside the lane pane. Split from a LIVE pane only — retired
  // workers close their panes, so a stale anchor pane_not_found's.
  private splitForWorker(cwd: string): string | null {
    if (!this.colUsed) {
      // Split the column head for the first worker too — a split sets
      // the unit cwd deterministically (no cd race); the empty head
      // closes and the worker takes the column.
      const pane = this.splitPane(this.colPane!, "down", cwd, 0.5)
      if (pane) this.herdr("pane", "close", this.colPane!)
      this.colUsed = true
      return pane
    }
    for (const anchor of [...this.liveWorkerPanes].reverse()) {
      const pane = this.splitPane(anchor, "down", cwd, 0.5)
      if (pane) return pane
    }
    if (this.viewerPane) return this.splitPane(this.viewerPane, "right", cwd, 0.7)
    return null
  }

  // -- worker birth ------------------------------------------------------------

  // The host session id, booked write-ahead (ADR 5) so a later continue
  // can resume this pane's conversation. herdr itself reports no session
  // id (verified live 2026-10-08) — the tools' own stores do: pi's jsonl
  // headers, the opencode db / CLI. (cwd, since) → newest in window.
  private resolveLiveSession(kind: string, cwd: string, since: string): string | null {
    try {
      const hit = kind === "pi" ? resolvePi({ tool: kind, cwd, since }) : resolveOpencode({ tool: kind, cwd, since })
      return hit?.id ?? null
    } catch {
      return null
    }
  }

  // Start an agent in an existing pane, record it, submit the brief.
  // since is stamped BEFORE the agent starts, so the host tool's session
  // (created during start) always falls inside the pointer's window.
  // resumeSession (ADR 5) continues a booked host session instead of
  // starting a fresh one (--session passes through to the agent CLI).
  // hold: a coworker member that does not initiate is born idle — its
  // brief rides WITH the first relayed message (zen 6).
  inhabitPane(
    rawName: string,
    kind: string,
    pane: string,
    briefPath: string,
    cwd: string,
    model: string | undefined = this.workerModel,
    seed: SeedPointer | undefined = undefined,
    hold = false,
    resumeSession: string | undefined = undefined,
  ): boolean {
    const since = new Date().toISOString()
    const name = this.scopedFn(rawName)
    this.cwdOf.set(name, cwd)
    this.briefOf.set(name, briefPath)
    const rec = this.shep("record", pane, name)
    if (rec.status !== 0) {
      // an unrecorded split pane would leak as a bare shell — close it
      this.herdr("pane", "close", pane)
      this.ledger?.emit("reject", { label: name, why: "record failed" })
      this.log(`record failed for ${name} on pane ${pane} — pane closed`)
      return false
    }
    const tail: string[] = []
    if (model && kind === "pi") {
      writePiSettings(cwd, model)
      const { provider, id } = splitModel(model)
      tail.push("--approve", "--provider", provider, "--model", id)
    } else if (model && kind === "opencode") {
      tail.push("--model", model)
    }
    if (resumeSession) tail.push("--session", resumeSession)
    const startArgs = tail.length ? ["--", ...tail] : []
    const start = this.herdr("agent", "start", name, "--kind", kind, "--pane", pane, "--timeout", String(START_TIMEOUT_MS), ...startArgs)
    if (start.status !== 0) {
      this.shep("retire", name)
      this.ledger?.emit("reject", { label: name, why: "agent start failed" })
      this.log(`agent start failed for ${name} (rc=${start.status}) — ghost cleared`)
      return false
    }
    if (!hold) {
      const brief = readFileSync(briefPath, "utf8")
      const prompt = this.herdr("agent", "prompt", name, brief)
      if (prompt.status !== 0) {
        this.log(`brief submission failed for ${name} — the grace reprompt will retry`)
      }
    }
    this.mine.add(name)
    const sessionId = resumeSession ?? this.resolveLiveSession(kind, cwd, since)
    this.ledger?.attach(
      name,
      pane,
      name.startsWith("orch-lane") ? undefined : name,
      { tool: kind, cwd, since, ...(sessionId ? { session_id: sessionId } : {}) } as TranscriptPointer,
      seed,
    )
    // The session mints on the first message and may land in the tool's
    // store a beat later — probe again shortly so the booked pointer
    // carries the id a Continue resumes
    if (!sessionId && !name.startsWith("orch-lane")) {
      setTimeout(() => {
        const late = this.resolveLiveSession(kind, cwd, since)
        if (late) this.ledger?.setSession(name, late)
      }, 5_000).unref()
    }
    return true
  }

  // -- ShepPort ----------------------------------------------------------------

  setLayout(want: Layout, dir: string): void {
    this.layout = want
    if (want.tab === "new") this.openFleetTab(dir)
  }

  spawnWorker(name: string, kind: string, briefPath: string, cwd: string): boolean {
    const label = this.scopedFn(name)
    this.cwdOf.set(label, cwd)
    this.briefOf.set(label, briefPath)
    if (this.layout.tab === "new" && this.colPane) {
      const pane = this.splitForWorker(cwd)
      if (!pane) {
        this.log(`pane split failed for ${label} — no live anchor`)
        return false
      }
      const ok = this.inhabitPane(name, kind, pane, briefPath, cwd)
      if (ok) {
        this.liveWorkerPanes.push(pane)
        this.paneOf.set(label, pane)
        this.log(`spawned ${label} (${kind}) in fleet tab pane ${pane}`)
      }
      return ok
    }
    const r = this.shep("spawn", label, "--kind", kind, "--cwd", cwd, "--brief", `@${briefPath}`)
    if (r.status !== 0) {
      this.shep("retire", label)
      this.ledger?.emit("reject", { label, why: "spawn failed" })
      this.log(`spawn failed for ${label} (rc=${r.status}) — ghost cleared`)
      return false
    }
    this.mine.add(label)
    this.ledger?.attach(label, undefined, name, { tool: kind, cwd, since: new Date().toISOString() } as TranscriptPointer)
    this.log(`spawned ${label} (${kind})`)
    return true
  }

  // ADR 5: a parked unit's pane is reborn with its host session resumed
  // (--session passes through herdr to the agent CLI) and the continue
  // brief. The shep path has no arg pass-through — a fresh pane with the
  // continue brief covers it (the unit dir is the outliving memory).
  resumeWorker(name: string, session: ResumePointerLike, briefPath: string, cwd: string): boolean {
    const label = this.scopedFn(name)
    this.cwdOf.set(label, cwd)
    this.briefOf.set(label, briefPath)
    if (this.layout.tab === "new" && this.colPane) {
      const pane = this.splitForWorker(cwd)
      if (!pane) {
        this.log(`pane split failed for ${label} — no live anchor`)
        return false
      }
      const ok = this.inhabitPane(name, session.tool, pane, briefPath, cwd, this.workerModel, undefined, false, session.session_id)
      if (ok) {
        this.liveWorkerPanes.push(pane)
        this.paneOf.set(label, pane)
        this.log(`resumed ${label} (${session.tool}, session ${session.session_id ?? "unbooked — briefed takeover"}) in fleet tab pane ${pane}`)
      }
      return ok
    }
    const r = this.shep("spawn", label, "--kind", session.tool, "--cwd", cwd, "--brief", `@${briefPath}`)
    if (r.status !== 0) {
      this.shep("retire", label)
      this.ledger?.emit("reject", { label, why: "resume spawn failed" })
      this.log(`resume spawn failed for ${label} (rc=${r.status}) — ghost cleared`)
      return false
    }
    this.mine.add(label)
    this.ledger?.attach(label, undefined, name, {
      tool: session.tool,
      cwd,
      since: new Date().toISOString(),
      ...(session.session_id ? { session_id: session.session_id } : {}),
    } as TranscriptPointer)
    this.log(`resumed ${label} (fresh pane, continue brief — session ${session.session_id ?? "unbooked"})`)
    return true
  }

  paneAlive(name: string): boolean {
    return this.herdr("agent", "get", this.scopedFn(name)).status === 0
  }

  paneBlocked(name: string): boolean {
    return this.agentState(name).includes('"agent_status":"blocked"')
  }

  reprompt(name: string, briefPath: string): boolean {
    try {
      const brief = readFileSync(briefPath, "utf8")
      const r = this.herdr("agent", "prompt", this.scopedFn(name), brief)
      if (r.status === 0) this.log(`reprompted ${this.scopedFn(name)} (brief re-submitted)`)
      return r.status === 0
    } catch {
      return false
    }
  }

  retire(name: string): void {
    const label = this.scopedFn(name)
    const r = this.shep("retire", label)
    if (r.status !== 0) this.shep("prune")
    this.mine.delete(label)
    this.ledger?.kill(label)
    const pane = this.paneOf.get(label)
    this.paneOf.delete(label)
    if (pane) {
      const i = this.liveWorkerPanes.indexOf(pane)
      if (i >= 0) this.liveWorkerPanes.splice(i, 1)
    }
    this.log(`retired ${label}`)
  }

  retireAll(): void {
    for (const name of [...this.mine]) {
      const r = this.shep("retire", name)
      if (r.status !== 0) this.shep("prune")
      this.ledger?.kill(name)
    }
    this.mine.clear()
    this.paneOf.clear()
    this.liveWorkerPanes.length = 0
    this.log("retired every pane this orchestrator spawned")
  }

  verify(): string {
    const r = this.shep("verify")
    const line = r.stdout.split("\n").find((l) => l.includes("pane-reap:"))
    return (line ?? "pane-reap: ? remaining").trim()
  }

  wake(label: string, kind: string, detail: string): void {
    this.shep("wake", "queue", label, kind, detail)
    this.log(`wake ${label} ${kind}: ${detail}`)
  }

  waitWorker(name: string, timeoutMs: number): Promise<"woke" | "miss"> {
    return new Promise((res) => {
      const started = Date.now()
      const child = spawn("herdr", [
        "agent", "wait", this.scopedFn(name),
        "--until", "done", "--until", "blocked",
        "--timeout", String(timeoutMs),
      ], { stdio: "ignore" })
      child.on("error", () => res("miss"))
      child.on("close", () => {
        // A wait that returns at once is not an event. Re-arming it spins.
        if (Date.now() - started < 1000) res("miss")
        else res("woke")
      })
    })
  }

  tailPane(logPath: string): boolean {
    // No mind rides the lane pane anymore: every workflow's lane pane
    // is the engine's log viewer (the only consumed judgment channel
    // in a lab is the actor's protocol.json)
    if (this.layout.tab === "new" && this.viewerPane) {
      const child = spawn("herdr", ["pane", "run", this.viewerPane, "tail", "-n", "+1", "-F", logPath], {
        detached: true,
        stdio: "ignore",
      })
      child.on("error", () => {})
      child.unref()
      this.log(`lane pane tailing this log (fleet tab pane ${this.viewerPane})`)
      return true
    }
    mkdirSync(join(this.taskDir, "briefs"), { recursive: true })
    const briefPath = join(this.taskDir, "briefs", "orch-lane.md")
    writeFileSync(
      briefPath,
      [
        "You are a log viewer. Run exactly this one command, then do nothing:",
        `tail -n +1 -F ${logPath}`,
        "",
        "Never do any other work. Never edit any file. If the tail command",
        "exits, run it again and idle.",
      ].join("\n"),
    )
    const label = this.scopedFn("orch-lane")
    const since = new Date().toISOString()
    const r = this.shep(
      "spawn", label, "--kind", "pi", "--cwd", this.taskDir,
      "--dir", "right", "--brief", `@${briefPath}`,
    )
    if (r.status !== 0) {
      this.shep("retire", label) // a failed spawn keeps its ledger entry — clear the ghost
      this.log("lane pane unavailable — read the orchestrator log instead")
      return false
    }
    this.mine.add(label)
    this.ledger?.attach(label, undefined, undefined, { tool: "pi", cwd: this.taskDir, since } as TranscriptPointer)
    return true
  }

  // -- permission sweep (zen 6) -------------------------------------------------
  //
  // The privilege half of JEV, one implementation for every workflow:
  // when a worker pane blocks on a permission dialog, the typed decider
  // answers it — allow (roots), deny (dangerous), deny-unneeded
  // (wandering, unless the tuned judge sees the need in the ask plus
  // the worker's brief) — with a message injected back. A repeated ask
  // for the same non-dangerous path escalates to a durable allow:
  // persistence is the asserted need the judge may have missed. No
  // dialog ever waits for a person. Capped like every retry surface.

  // Answer one worker's permission dialog, if it has one. Roots default
  // to the pane's booked cwd plus the task dir and program roots;
  // context defaults to the pane's booked brief. Returns the verdict:
  // "none" (no dialog), "allow", "deny", or "capped" (ask cap hit —
  // the caller settles or kills the worker).
  answerPermission(
    name: string,
    opts: { roots?: string[]; context?: string } = {},
  ): "allow" | "deny" | "none" | "capped" {
    const label = this.scopedFn(name)
    if (!this.agentState(name).includes('"agent_status":"blocked"')) return "none"
    const term = this.herdr("agent", "read", label).stdout
    const at = term.lastIndexOf("Permission required")
    const question = at >= 0 ? term.slice(at, at + 2000) : term.slice(-2000)
    const cwd = this.cwdOf.get(label) ?? this.taskDir
    const briefFile = this.briefOf.get(label)
    const context =
      opts.context ?? (briefFile && existsSync(briefFile) ? readFileSync(briefFile, "utf8").slice(0, 2000) : undefined)
    const raw = decidePermission(
      {
        question,
        allowedRoots: opts.roots ?? [cwd, this.taskDir, ...this.programRoots].filter((r) => r.length > 0),
        context,
      },
      this.judge ?? tunedPermissionJudge(),
    )
    const key = `${label}|${raw.path ?? "?"}`
    const prior = this.pathAsks.get(key) ?? 0
    this.pathAsks.set(key, prior + 1)
    const verdict = escalateOnRepeat(raw, prior)
    const asked = (this.askedCount.get(label) ?? 0) + 1
    this.askedCount.set(label, asked)
    if (verdict.decision === "allow" && verdict.path) {
      addWorkerRoot(cwd, verdict.path.replace(/\/[^/]*$/, ""))
      this.herdr("agent", "send-keys", label, "enter")
    } else {
      this.herdr("agent", "send-keys", label, "esc")
      const note = `[permission] ${verdict.message}`
      const rc = this.herdr("agent", "prompt", label, note)
      if (rc.status !== 0) this.pendingNote.set(label, note)
    }
    this.ledger?.emit("permission", { member: label, decision: verdict.decision, path: verdict.path, ask: asked })
    this.log(`permission ${label} #${asked}: ${verdict.decision} ${verdict.path ?? "(no path)"}`)
    this.say("watcher", `permission ${label} ${verdict.decision}`)
    return asked >= PERMISSION_CAP ? "capped" : verdict.decision === "allow" ? "allow" : "deny"
  }

  // Flush queued permission notes into panes that can take them (a
  // blocked or working pane refuses prompts — the note waits).
  flushPendingNotes(): number {
    let flushed = 0
    for (const [held, note] of this.pendingNote) {
      const st = this.agentState(held)
      if (st.includes('"agent_status":"blocked"') || st.includes('"agent_status":"working"')) continue
      if (this.herdr("agent", "prompt", held, note).status === 0) {
        this.pendingNote.delete(held)
        this.log(`injected queued note into ${held}`)
        flushed++
      }
    }
    return flushed
  }

  // -- lab board layout (lanes.ts) ---------------------------------------------

  // Engines prompt panes by name; the runner behind it is the seam.
  promptAgent(name: string, text: string): RunnerResult {
    return this.herdr("agent", "prompt", this.scopedFn(name), text)
  }

  // Raw `agent get` stdout — engines grep agent_status from it.
  agentStatus(name: string): string {
    return this.agentState(name)
  }

  renamePane(pane: string, name: string): void {
    this.herdr("pane", "rename", pane, name)
  }

  closePane(pane: string): void {
    this.herdr("pane", "close", pane)
  }

  // A held member mints its session on its first prompt — book it
  // shortly (ADR 5), so a continue resumes its conversation.
  bookSessionLate(name: string, kind: string, cwd: string, since: string): void {
    setTimeout(() => {
      const sid = this.resolveLiveSession(kind, cwd, since)
      if (sid) this.ledger?.setSession(this.scopedFn(name), sid)
    }, 5_000).unref()
  }

  layoutOf(pane: string): { area: { width: number; height: number }; panes: { pane_id: string; rect: { x: number; y: number; width: number; height: number } }[] } | null {
    const r = this.herdr("pane", "layout", "--pane", pane)
    return jsonAt(r.stdout, (d) => (d as { result?: { layout?: never } }).result?.layout ?? null)
  }

  equalize(ids: string[], axis: "x" | "y"): void {
    if (ids.length < 2) return
    for (let pass = 0; pass < 8; pass++) {
      const lay = this.layoutOf(ids[0]!)
      if (!lay) return
      const total = axis === "x" ? lay.area.width : lay.area.height
      const byId = new Map(lay.panes.map((pane) => [pane.pane_id, pane.rect]))
      const target = total / ids.length
      let moved = false
      for (let i = 0; i < ids.length - 1; i++) {
        const rect = byId.get(ids[i]!)
        if (!rect) continue
        const size = axis === "x" ? rect.width : rect.height
        const delta = size - target
        if (Math.abs(delta) < 2) continue
        const amount = Math.min(0.4, Math.abs(delta) / total)
        const dir = axis === "x" ? (delta > 0 ? "left" : "right") : (delta > 0 ? "up" : "down")
        this.herdr("pane", "resize", "--pane", ids[i + 1]!, "--direction", dir, "--amount", String(amount))
        moved = true
        break
      }
      if (!moved) return
    }
  }

  openShell(dir: string, label: string): string | null {
    const r = this.herdr("tab", "create", "--label", label.slice(0, 40), "--cwd", dir, "--no-focus")
    const root = jsonAt(r.stdout, (d) => (d as { result?: { root_pane?: { pane_id?: string } } }).result?.root_pane?.pane_id ?? null)
    if (!root) return null
    const shell = this.splitPane(root, "right", dir, 0.5)
    if (!shell) return null
    this.herdr("pane", "close", root)
    return shell
  }

  ensureRole(board: Board, role: string, dir: string): { board: Board; pane: string | null } {
    const placed = place(board, role)
    if (placed.kind === "first" || placed.kind === "overflow-tab") {
      const pane = this.openShell(dir, role)
      if (!pane) return { board, pane: null }
      return { board: note(board, placed, pane), pane }
    }
    if (placed.kind === "have") {
      return { board, pane: board.tabs[placed.tab].lanes[placed.lane].panes[0] }
    }
    if (placed.kind === "lane") {
      const tab = board.tabs[placed.tab]
      const from = tab.lanes[tab.lanes.length - 1]!.panes[0]!
      const pane = this.splitPane(from, "right", dir, 0.5)
      if (!pane) return { board, pane: null }
      const next = note(board, placed, pane)
      this.equalize(next.tabs[placed.tab].lanes.map((lane) => lane.panes[0]!), "x")
      return { board: next, pane }
    }
    const lane = board.tabs[placed.tab].lanes[placed.lane]
    const from = lane.panes[lane.panes.length - 1]!
    const pane = this.splitPane(from, "down", dir, 0.5)
    if (!pane) return { board, pane: null }
    const next = note(board, placed, pane)
    this.equalize(next.tabs[placed.tab].lanes[placed.lane].panes, "y")
    return { board: next, pane }
  }

  dropPane(board: Board, pane: string): Board {
    return drop(board, pane)
  }

  // -- verbose lane -------------------------------------------------------------

  wantVerbose(dir: string = this.taskDir): boolean {
    if (process.env.AGENTIC_OS_VERBOSE === "1") return true
    try {
      return verboseOn(readFileSync(join(dir, "workflow.toml"), "utf8"))
    } catch {
      return false
    }
  }

  say(who: string, what: string): void {
    const line = sayOnce(this.seen, `${who} ${what}`, beat(who, what))
    if (!line) return
    this.log(line)
    if (this.verbosePath) appendFileSync(this.verbosePath, `${new Date().toISOString()} ${line}\n`)
  }

  openVerbose(dir: string = this.taskDir): void {
    const path = join(dir, "verbose.log")
    writeFileSync(path, "")
    const pane = this.openShell(dir, "verbose")
    if (!pane) {
      this.log("verbose tab failed")
      return
    }
    this.verbosePath = path
    this.verbosePane = pane
    this.herdr("pane", "rename", pane, "verbose")
    const child = spawn("herdr", ["pane", "run", pane, "tail", "-n", "+1", "-F", path], {
      detached: true,
      stdio: "ignore",
    })
    child.on("error", () => {})
    child.unref()
    this.say("rail", "verbose tab open")
  }

  closeVerbose(): void {
    if (this.verbosePane) this.herdr("pane", "close", this.verbosePane)
  }

  // -- door protocol: signals and the engine epilogue ----------------------------
  //
  // One epilogue for every door (was copy-pasted per bin): run the
  // engine, then park on null, finish on a report, abort+exit-code on
  // a throw. Signals: SIGINT always aborts; SIGTERM drains when the
  // engine installs a drainHook (coworker) or aborts when the door
  // asks for termDrains — a door whose ENGINE owns SIGTERM (fan-out's
  // runOrchestrator traps it internally) passes nothing.

  trapSignals(opts: { termDrains?: boolean } = {}): void {
    process.on("SIGINT", () => {
      this.ledger?.abort("signal SIGINT", this.mine.size)
      process.exit(0)
    })
    if (opts.termDrains) {
      process.on("SIGTERM", () => {
        if (this.drainHook) return this.drainHook()
        this.ledger?.abort("signal SIGTERM", this.mine.size)
        process.exit(0)
      })
    }
  }

  async run(engine: () => Promise<Report | null>): Promise<number> {
    try {
      const report = await engine()
      if (!report) {
        // parked (ADR 5): the rail drained to its boundary and retired
        // its panes — book the pause; a typed continue brings the Job back.
        this.ledger?.pause("drained", this.ledger.job.panes.filter((p) => p.died === undefined).length)
        this.log(`parked: paused — continue with: agentic-os continue ${this.ledger?.job.id ?? "<jid>"}`)
        return 0
      }
      this.log(`done: ${report.status}`)
      const reap = this.verify()
      // zen 5: the receipt counts THIS Job's panes, not the scope's
      const panesLeft = this.ledger
        ? this.ledger.job.panes.filter((p) => p.died === undefined).length
        : NaN
      this.log(`${reap} (scope); this job: ${panesLeft} of ${this.ledger?.job.panes.length ?? "?"} panes remain`)
      this.ledger?.finish({
        panesRemaining: panesLeft,
        panesTotal: this.ledger.job.panes.length,
        unitsDone: Number(report.counts?.units ?? NaN),
        unitsFailed: Number(report.counts?.failed ?? NaN),
        status: report.status,
        report: join(this.taskDir, "report.json"),
      })
      return 0
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      this.log(`fatal: ${why}`)
      this.ledger?.emit("fatal", { why: String(why) })
      this.ledger?.abort(`fatal: ${why}`, this.mine.size)
      this.wake("fan-out", "blocked", `orchestrator died: ${this.taskDir}/orchestrator.log`)
      return 1
    }
  }
}

// local aliases keep the store's record shapes out of the public face
type ResumePointerLike = { tool: string; session_id?: string; cwd: string }
type PaneRecordLike = { unit?: string; born: string; transcript?: { tool: string; session_id?: string; cwd?: string } }
