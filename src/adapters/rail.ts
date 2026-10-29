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
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"
import { isProviderFault, parseModelRef } from "../jev/model-ladder.ts"
import { landMockUnit, loadManifest, type Layout, type Manifest } from "../doors/hooks.ts"
import { drop, note, place, type Board } from "../core/lanes.ts"
import { paneLabeler, runIdFor, type AgentStatus, type ShepPort } from "../engines/orchestrator.ts"
import { decidePermission, declareScope, escalateOnRepeat, expandHome, PERMISSION_CAP, splitRoMarker, tunedPermissionJudge, type PathScope, type PermissionJudge } from "../core/permission.ts"
import type { Report } from "../core/report.ts"
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
  renewLeaseOf,
  acquireLease,
  LEASE_HELD_BY_LIVE_ORCHESTRATOR,
  saveJob,
  setPaneSession,
  writeWorkerPermissions,
  type JobRecord,
  type Receipt,
  type SeedPointer,
  type TranscriptPointer,
} from "./store.ts"
import { readState } from "../core/state.ts"
import { resolveOpencode, resolvePi } from "./transcripts.ts"
import { defaultRunner, jsonAt, type RunnerResult } from "../doors/runners.ts"
import { HerdrTransport } from "./herdr-transport.ts"
import { OpenCodeHost, parseAgentStatus } from "./opencode-host.ts"
import type { AgentHost, UsageRow } from "../ports/agent-host.ts"
import type { Transport } from "../ports/transport.ts"
import { beat, note as sayOnce, verboseOn } from "../core/verbose.ts"

export type { RunnerResult } from "../doors/runners.ts"

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
  // Issue #123 — renew the job lease on the engine beat (one write per
  // beat; a lease record must never break the run it observes)
  renew: () => void
}

function doorRev(): string {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
      timeout: 5_000,
    })
    return r.stdout?.trim() || "unknown"
  } catch {
    return "unknown"
  }
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
  // the plugin slots (the migration seam, formalized): a Transport
  // answers "how panes are addressed" (default: herdr CLI); an
  // AgentHost answers "what runs inside one" (default: opencode/pi).
  // Swap either and the rail does not change.
  transport?: Transport
  host?: AgentHost
  ledger?: RailLedger | null
  judge?: PermissionJudge
  // the home tree dialogs normalize against (default: the real one);
  // tests inject a tmp home so the stripped-form resolver hits real
  // directories without touching ~
  home?: string
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

// The stand-down refusal marker (r26 tests-4) — the same escape
// pattern as the lease refusal: a message prefix thrown at the write
// site, rethrown by openLedger's outer catch so the boot DIES instead
// of degrading into an unledgered drive-on.
export const STAND_DOWN = "STAND_DOWN"

const WORKER_SHARE = 0.5

export class Rail implements ShepPort {
  readonly taskDir: string
  readonly log: (msg: string) => void
  readonly ledger: RailLedger | null
  // the canonical path predicate's scope (OPTIMUM §5): the task dir
  // plus the door's sanitized programRoots, constructed once — the
  // dialog ladder, the pre-seed writes, and every roots consumer read
  // from here; nobody assembles a root set of their own anymore
  readonly scope: PathScope
  readonly mine = new Set<string>()
  private readonly workerModel: string | undefined
  private readonly shepRun: (args: string[]) => RunnerResult
  private readonly herdrRun: (args: string[]) => RunnerResult
  private readonly transport: Transport
  private readonly host: AgentHost
  private readonly judge: PermissionJudge | undefined
  // the home tree dialog paths normalize against (j-2b508e: a path
  // shown without its /Users/<who> prefix is the same ask as the full
  // form — one ladder, one reason)
  private readonly home: string
  private readonly scopedFn: (name: string) => string
  // per-pane memory the permission sweep derives roots and context from
  private readonly cwdOf = new Map<string, string>()
  // spawn-time worker kind per label — tryBookSession needs it to
  // re-resolve a session (the birth judge's second look)
  private readonly kindOf = new Map<string, string>()

  // #104 / #201: the worker's cumulative token usage, addressed by
  // NAME — the rail knows the sandbox cwd, the host knows its own
  // store. Null = no row (best-effort, never a gate).
  usageOf(rawName: string, sinceMs: number): UsageRow | null {
    const cwd = this.cwdOf.get(this.scopedName(rawName)) ?? this.cwdOf.get(rawName)
    if (!cwd) return null
    return this.host.usageOf(cwd, sinceMs)
  }
  private readonly briefOf = new Map<string, string>()
  // fleet tab state (layout tab = "new")
  private layout: { tab: "same" | "new"; orchestrator: "left" | "right" } = { tab: "same", orchestrator: "left" }
  private fleetRoot: string | null = null
  private fleetTab: string | null = null
  private viewerPane: string | null = null
  // Privilege sweep bookkeeping: every pane the rail holds (mine), the
  // panes born as ENGINE workers via spawnWorker (workers — engines
  // carry the capped consequence for these), and the pane id per label
  // so an untracked capped pane can be closed.
  private readonly workers = new Set<string>()
  private readonly paneOf = new Map<string, string>()
  private readonly unscopedOf = new Map<string, string>()
  private colPane: string | null = null
  private colUsed = false
  private readonly liveWorkerPanes: string[] = []
  // verbose lane
  private readonly seen = new Map<string, string>()
  // C06 — the provider-fault probe is a 20s-ceiling CLI call and the
  // coworker judgment loop asks per cycle per member; within one TTL
  // window the answer cannot change (the ladder's backoff is minutes).
  private readonly faultMemo = new Map<string, { at: number; hit: { id: string; type: string } | null }>()
  private verbosePath: string | null = null
  private verbosePane: string | null = null
  // the drain seam (ADR 5): every engine drains — each registers via
  // installDrain (fan-out at runOrchestrator start, coworker at
  // birth, lab at boot); the stack + composite getter live at
  // installDrain (station tenancy, ADR 0016)
  // permission sweep state (zen 6): asks per pane (display numbering),
  // deny-family answers per pane (cap spend — allows are free), asks
  // per pane+path, and verdict notes queued for a pane that could not
  // take them
  private readonly askedCount = new Map<string, number>()
  private readonly denyCount = new Map<string, number>()
  private readonly pathAsks = new Map<string, number>()
  private readonly pendingNote = new Map<string, string>()

  constructor(opts: RailOpts = {}) {
    this.log = opts.log ?? ((msg) => console.log(`${new Date().toISOString()} ${msg}`))
    this.shepRun = opts.shepRunner ?? defaultRunner("shep")
    this.herdrRun = opts.herdrRunner ?? defaultRunner("herdr")
    // the plugin slots, wired: transport addresses panes, the host is
    // the agent CLI that occupies one — Rail keeps the ledger, the
    // sweep, and the layout policy above both
    this.transport = opts.transport ?? new HerdrTransport(this.herdrRun, this.log)
    this.host = opts.host ?? new OpenCodeHost(this.transport, this.log)
    this.judge = opts.judge
    this.home = opts.home ?? homedir()
    this.ledger = opts.ledger !== undefined ? opts.ledger : this.openLedger(opts.argvDir ?? null, opts.workflow ?? "fan-out")
    this.taskDir = opts.argvDir ?? this.ledger?.job.dir ?? resolve(process.cwd())
    // the scope is declared once, after the task dir exists — the doors'
    // already-sanitized programRoots pass through declareScope unchanged
    this.scope = declareScope([this.taskDir, ...(opts.programRoots ?? [])])
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
      // Issue #123 — the orchestrator claims the lease at open: a
      // written, expiring record of WHO leads this job. Renewed on the
      // engine beat; expiry is sticky (no message needed on death).
      // The mutex half (j-93d652 gap #2): a LIVE holder refuses us —
      // one writer per job, so a double `whl continue` dies at the
      // door instead of split-braining the exchange.
      // The WRITE-SITE single-act law (r21 principles-13/r18
      // momentum-1): the boot-time load is a snapshot; the disk is
      // re-read HERE, at the write, before the lease or the pid/door
      // stamp touch it.
      let fresh = job
      try {
        fresh = loadJob(sid0, jid0) ?? job
        acquireLease(fresh, `orchestrator pid=${process.pid}`)
      } catch (err) {
        if (err instanceof Error && err.message.startsWith(LEASE_HELD_BY_LIVE_ORCHESTRATOR)) throw err
        this.log("lease: acquire failed — the run continues unleased")
      }
      // The stand-down law, seated AFTER the lease round-trip — and
      // answering for EVERY parked state (r23 principles-14: orphaned
      // alone missed pause/abort flips in the snapshot→write gap — an
      // abort booked in the window was stamped and driven to
      // completion). THIS boot stands down unless the record still
      // reads running on disk: any parked/dead receipt (pause, abort,
      // orphan) stands, and `whl continue` owns the revival.
      if (fresh.state !== "running") {
        // the STAND_DOWN prefix makes this refuse like the lease
        // refusal (r26 tests-4): raised inside the outer try, it must
        // be rethrown by the outer catch — swallowed, it became
        // "running without a Job record" and drove the program to
        // completion unledgered, the exact opposite of standing down.
        throw new Error(
          `${STAND_DOWN}: the Job flipped to ${fresh.state} during this boot (a pause/abort/orphan receipt stands) — run: whitehartlane continue ${job.id}`,
        )
      }
      // The stamp writes the FRESH record (the same re-read the lease
      // acquire used) — never the boot-time snapshot.
      const booked = fresh
      booked.pid = process.pid
      booked.door = { rev: doorRev(), started: new Date().toISOString() }
      saveJob(booked)
      const holder = `orchestrator pid=${process.pid}`
      return {
        job: booked,
        renew: () => renewLeaseOf(booked, holder),
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
      // A lease refusal is the door closing, not the ledger failing:
      // it escapes to the bin, which exits before a single pane is
      // born. (Pre-fix this catch swallowed the refusal into "running
      // without a Job record" — the second orchestrator then drove the
      // task dir unledgered, and its retireAll pkill killed the live
      // holder's fleet: the exact split brain the lease exists to
      // prevent, j-93d652 gap #2.)
      if (err instanceof Error && err.message.startsWith(LEASE_HELD_BY_LIVE_ORCHESTRATOR)) throw err
      // the stand-down refuses the same way (r26 tests-4): the boot
      // MUST die here — swallowed, it became "running without a Job
      // record" and drove the staged program to completion unledgered,
      // the exact opposite of standing down
      if (err instanceof Error && err.message.startsWith(STAND_DOWN)) throw err
      this.log(`ledger unavailable (${err instanceof Error ? err.message : String(err)}) — running without a Job record`)
      return null
    }
  }

  // -- helpers the bins reach through -----------------------------------------

  scopedName(name: string): string {
    const scoped = this.scopedFn(name)
    this.unscopedOf.set(scoped, name)
    return scoped
  }

  // Pre-seed a worker sandbox's opencode.json from the scope (plus any
  // runtime extras — member roots arrive here still tilde-form; the
  // predicate's one expandHome spelling applies). The bins reach
  // through with the program roots; engines pre-grant member sandboxes.
  writePermissions(dir: string = this.taskDir, extraRoots: string[] = []): void {
    // markers can't reach here (member ro refuses at parse); the strip
    // is belt-and-suspenders so a marker never mints a bogus grant
    writeWorkerPermissions(dir, [...this.scope.roots, ...extraRoots.map((r) => expandHome(splitRoMarker(r).path))])
  }

  existingRows(): { unit: string; result: string; pass: boolean }[] | undefined {
    if (!this.ledger) return undefined
    return readEvents(this.ledger.job.sid)
      .filter((e) => e.jid === this.ledger!.job.id && e.kind === "unit.finished")
      .map((e) => ({ unit: String(e.unit), result: String(e.result ?? ""), pass: e.pass === true }))
  }

  // ADR 5: unfinished units of an earlier generation resume from the
  // pane ledger — the latest pane record per unfinished unit carries the
  // booked session pointer (write-ahead at spawn, session id at birth).
  resumesForUnfinished(): Map<string, ResumePointerLike> {
    const resumes = new Map<string, ResumePointerLike>()
    if (!this.ledger) return resumes
    const finished = readState(this.taskDir)
    const closed = new Set([...finished.done, ...finished.failed])
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

  private agentState(name: string): string {
    return this.transport.exec(["agent", "get", this.scopedFn(name)]).stdout
  }

  // -- fleet tab layout --------------------------------------------------------

  private splitPane(fromPane: string, direction: string, cwd: string, ratio: number): string | null {
    return this.transport.splitPane(fromPane, direction, cwd, ratio)
  }

  private openFleetTab(dir: string): void {
    // dir is the run dir (<session>/jobs/<jid>/run) — label by the JOB, not
    // basename(dir) ("run" told the user nothing on leftover tabs)
    const label = `fan-out-${basename(dirname(dir))}`.slice(0, 40)
    // The fleet belongs beside its levy: the spawner pane (booked at
    // `whl run` from HERDR_PANE_ID) names the workspace — "wK:pGT" → wK.
    // Unscoped create lands in herdr's CURRENT workspace, which drifts
    // (j-5701b2: levy in wK, fleet tab opened in wJ where nobody looked).
    const spawnerPane = this.ledger?.job.spawner?.pane
    const ws = spawnerPane?.includes(":") ? spawnerPane.split(":")[0] : null
    const created = (scoped: boolean) => this.transport.tabCreate(label, dir, scoped ? ws : null)
    let r = created(true)
    if (!r.root && ws) {
      // a stale/unknown workspace id must not cost the layout — retry unscoped
      this.log(`fleet tab in workspace ${ws} unavailable (rc=${r.status}) — retrying unscoped`)
      r = created(false)
    }
    if (!r.root) {
      this.log(`fleet tab unavailable (rc=${r.status}) — falling back to same-tab layout`)
      this.layout = { ...this.layout, tab: "same" }
      return
    }
    this.fleetRoot = r.root
    this.fleetTab = r.tab
    this.log(`fleet tab ${label} opened (workers anchor on the tab root — no viewer lane)`)
    // v2 layout (2026-10-17): no reserved viewer lane. The old layout
    // pre-split a 50-50 "orchestrator viewer" pane that no code ever
    // populated — it sat empty for the job's whole lifetime and read as
    // a stuck pane. The worker column anchors on the tab root itself:
    // the first worker splits it downward and takes over (splitForWorker).
    this.viewerPane = null
    this.colPane = r.root
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
      if (pane) this.transport.exec("pane", "close", this.colPane!)
      this.colUsed = true
      return pane
    }
    for (const anchor of [...this.liveWorkerPanes].reverse()) {
      const pane = this.splitPane(anchor, "down", cwd, 0.5)
      if (pane) return pane
    }
    // v2: the viewer-lane fallback is gone (the lane never existed as a
    // populated pane) — a lane with no live worker pane to anchor on fails
    // loudly instead of splitting a dead pane.
    // #165 / j-214576: "loudly" must not mean "instantly dead" when the
    // TAB is alive. Between stages every worker pane may be retired while
    // the column head was consumed at birth (first worker split it and it
    // closed) — an empty live-anchor list then orphaned the whole next
    // stage. The fleet tab itself is the anchor of last resort: any live
    // pane in OUR tab can seed the new column. Splitting a stranger in
    // our own house is honest; a stage dying because cleanup ran between
    // stages is not.
    const listed = this.transport.exec("pane", "list")
    const seed = jsonAt(listed.stdout, (d) => {
      const panes = (d as { result?: { panes?: Array<{ pane_id?: string; tab_id?: string }> } }).result?.panes ?? []
      return panes.find((p) => p.tab_id === this.fleetTab && p.pane_id)?.pane_id ?? null
    })
    if (seed) {
      const fresh = this.splitPane(seed, "down", cwd, 0.5)
      if (fresh) {
        this.log(`column re-seeded on fleet-tab pane ${seed} — live-anchor list was empty between stages (#165)`)
        return fresh
      }
    }
    // The GONE tab is the last gap (#165's twin): herdr closes a tab
    // whose last pane closed, so between stages the fleet's whole house
    // can vanish — every pane retired, tab and all. A later stage's
    // spawn must re-open the house, not die (the pr-review drill's
    // divide stage: lenses retired, divider spawn failed 3× and blocked
    // the chain on a cleanup race, j-d0fdc8). One attempt; a re-open
    // that fails falls through to the loud failure below.
    if (!seed && listed.status === 0 && this.fleetTab) {
      this.log("fleet tab gone between stages — re-opening the column (a stage must not die because cleanup ran first)")
      this.colUsed = false
      this.openFleetTab(this.taskDir)
      if (this.colPane && this.layout.tab !== "same") {
        const pane = this.splitPane(this.colPane, "down", cwd, 0.5)
        if (pane) {
          this.transport.exec("pane", "close", this.colPane)
          this.colUsed = true
          return pane
        }
      }
    }
    this.log(`pane split failed for the fleet column — no live anchor (tab ${this.fleetTab ?? "?"}; pane-list rc=${listed.status}${seed ? ", split failed" : ", tab empty"})`)
    return null
  }

  // -- worker birth ------------------------------------------------------------

  // The host session id, booked write-ahead (ADR 5) so a later continue
  // can resume this pane's conversation. herdr itself reports no session
  // id (verified live 2026-10-08) — the tools' own stores do: pi's jsonl
  // headers, the opencode db / CLI. (cwd, since) → newest in window,
  // disambiguated by the brief's marker when siblings share the cwd
  // (j-78ca43: two workers in one worktree cross-booked each other).
  private resolveLiveSession(kind: string, cwd: string, since: string, expect?: string): string | null {
    try {
      const hit = kind === "pi" ? resolvePi({ tool: kind, cwd, since }, expect) : resolveOpencode({ tool: kind, cwd, since }, expect)
      return hit?.id ?? null
    } catch {
      return null
    }
  }

  // A MARKERED resolve answers both path spellings the first-user
  // message can carry (gate-r9 tests-300): the absolute brief dir AND
  // its cwd-relative form — briefs and prompts speak relative paths
  // ("units/w-api", "../../data/review/…"), and a marker that only
  // matched absolutes never matched anything real, silently handing
  // every booking to the marker-less newest-wins fallback — the
  // cross-booking j-78ca43's marker was written to prevent.
  private resolveMarkedSession(kind: string, cwd: string, since: string, marker: string): string | null {
    const abs = this.resolveLiveSession(kind, cwd, since, marker)
    if (abs !== null) return abs
    // rel "" is DEGENERATE (gate-r12 tests-601): the fan-out norm puts
    // the brief IN the pane's cwd (marker === cwd), and
    // resolveOpencode treats an empty expect as FALSY (`if (expect)`)
    // — the probe would answer marker-less newest-wins, the forbidden
    // fallback the doctrine above forbids. "" cannot appear in any
    // first message as a path; the abs arm already answered.
    const rel = relative(cwd, marker)
    return rel !== "" && rel !== marker ? this.resolveLiveSession(kind, cwd, since, rel) : null
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
    temperature: number | undefined = undefined,
  ): boolean {
    const since = new Date().toISOString()
    const name = this.scopedName(rawName)
    this.cwdOf.set(name, cwd)
    this.briefOf.set(name, briefPath)
    // gate-r5 momentum-17: the pane's KIND books at the BIRTH site —
    // the fleet-tab path both spawnWorker and resumeWorker delegate
    // here; a pane whose agent boards slower than the one-shot +5s
    // probe needs tryBookSession, and its guard (!cwd || !kind)
    // refused every pane born without this row
    this.kindOf.set(name, kind)
    const rec = this.shep("record", pane, name)
    if (rec.status !== 0) {
      // an unrecorded split pane would leak as a bare shell — close it
      this.transport.exec("pane", "close", pane)
      this.ledger?.emit("reject", { label: name, why: "record failed" })
      this.log(`record failed for ${name} on pane ${pane} — pane closed`)
      return false
    }
    // the agent CLI's birth belongs to the HOST: the model pin (each
    // CLI's own settings file), the brownout guard (stagger + start
    // retry, ADR 0010), and the brief delivery. Rail keeps only the
    // ledger bookkeeping around it.
    const ok = this.host.inhabit(name, pane, { kind, briefPath, cwd, model, hold, resumeSession, temperature })
    if (!ok) {
      this.shep("retire", name)
      this.ledger?.emit("reject", { label: name, why: "agent start failed" })
      return false
    }
    this.mine.add(name)
    this.workers.add(name)
    this.paneOf.set(name, pane)
    // the unit dir appears in every brief variant (Work dir / Unit dir /
    // the deliverable path) and never in a sibling's brief — the marker
    // that keeps shared-cwd bookings straight
    const marker = dirname(briefPath)
    const sessionId = resumeSession ?? this.resolveLiveSession(kind, cwd, since, marker)
    // the ledger's unit column carries the RAW name the engine birthed
    // ("w-<id>", "mock-<id>", "actor", a member name) — the scoped
    // label is p.label's job; duplicating it in p.unit hid the unit
    // identity every ADR-5 resume fold keys on (lab's bookings, the
    // fan-out resumes re-key in engine.ts)
    this.ledger?.attach(
      name,
      pane,
      rawName,
      { tool: kind, cwd, since, ...(sessionId ? { session_id: sessionId } : {}) } as TranscriptPointer,
      seed,
    )
    // The session mints on the first message and may land in the tool's
    // store a beat later — probe again shortly so the booked pointer
    // carries the id a Continue resumes. THE MARKER DOCTRINE (gate-r10
    // momentum-23/principles-32): this third booker joins the law the
    // other two already state — a marker in hand means the marker is
    // the discriminator; a marker miss means not-committed-yet, NEVER
    // the newest sibling's session. The old "plain newest-wins as the
    // last resort, so a session always books eventually" booked A
    // SIBLING's session on this pane's row (cross-booking ADR-5
    // continues and fault-lane switches); the booking this timer
    // exists for can wait for the message to commit.
    if (!sessionId) {
      setTimeout(() => {
        const late = marker
          ? this.resolveMarkedSession(kind, cwd, since, marker)
          : this.resolveLiveSession(kind, cwd, since)
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

  spawnWorker(name: string, kind: string, briefPath: string, cwd: string, model?: string, temperature?: number): boolean {
    const label = this.scopedName(name)
    this.cwdOf.set(label, cwd)
    this.briefOf.set(label, briefPath)
    this.kindOf.set(label, kind)
    // DRY-RUN (worker_kind = "mock"): no pane, no agent — the unit's
    // done line lands next to its brief and the cycle settles it
    // through the real path. Checks, gates, and grades all fire, so a
    // whole program's shape rehearses in seconds, zero tokens.
    if (kind === "mock") {
      landMockUnit(briefPath, name)
      this.log(`dry-run: ${label} settled by mock — no pane, no agent`)
      return true
    }
    // issue #249 — the unit sandbox inherits NOTHING: pre-seed the same
    // isolation the run root carries (scoped permissions, every global
    // MCP server neutralized) BEFORE the host's read-modify-write adds
    // the model pin. Without this the unit's nearest config carried
    // only the model, and opencode merged the operator's INTERACTIVE
    // global config for everything else — its integration surface
    // could block the brief's send (j-4a0009: a pane lived its whole
    // life behind the "Connect an integration" modal; one in four
    // panes lost that race)
    this.writePermissions(cwd)
    // Per-mind pin (issue #152 seam widening): a spawn carrying a pin
    // that differs from the manifest pin cannot ride the CLI
    // transport (it passes --kind only) — refuse honestly, never
    // silently downgrade a worker to the wrong model. The temperature
    // twin (self-review r6b questions-1): the shep path has no
    // settings pass-through, so a declared pin would vanish — same
    // refusal, same reason.
    if (!(this.layout.tab === "new" && this.colPane)) {
      if (model !== undefined && model !== this.workerModel) {
        this.ledger?.emit("reject", { label, why: `per-unit model ${model} needs the fleet-pane path (CLI transport carries one pin)` })
        this.log(`spawn refused for ${label}: per-unit model ${model} needs the fleet-pane path (CLI transport carries one pin)`)
        return false
      }
      if (temperature !== undefined) {
        this.ledger?.emit("reject", { label, why: "per-unit temperature needs the fleet-pane path (the CLI transport drops it)" })
        this.log(`spawn refused for ${label}: per-unit temperature ${temperature} needs the fleet-pane path (the CLI transport drops it)`)
        return false
      }
    }
    if (this.layout.tab === "new" && this.colPane) {
      const pane = this.splitForWorker(cwd)
      if (!pane) {
        this.log(`pane split failed for ${label} — no live anchor`)
        return false
      }
      const ok = this.inhabitPane(name, kind, pane, briefPath, cwd, model, undefined, false, undefined, temperature)
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
    this.workers.add(label)
    this.ledger?.attach(label, undefined, name, { tool: kind, cwd, since: new Date().toISOString() } as TranscriptPointer)
    this.log(`spawned ${label} (${kind})`)
    return true
  }

  // ADR 5: a parked unit's pane is reborn with its host session resumed
  // (--session passes through herdr to the agent CLI) and the continue
  // brief. The shep path has no arg pass-through — a fresh pane with the
  // continue brief covers it (the unit dir is the outliving memory).
  resumeWorker(name: string, session: ResumePointerLike, briefPath: string, cwd: string, model?: string, temperature?: number): boolean {
    const label = this.scopedName(name)
    this.cwdOf.set(label, cwd)
    this.briefOf.set(label, briefPath)
    // gate-r4 principles-25: the resumed pane's KIND books too —
    // tryBookSession's guard (`!cwd || !kind`) structurally refused
    // the birth judge's one-last-look for every resumed pane, and a
    // late-boarding resume was judged dead at birth despite boarding
    // (the judge's own r6 doctrine: boarded — however quiet — is
    // spared; session existence is the only key)
    this.kindOf.set(label, session.tool)
    if (!(this.layout.tab === "new" && this.colPane)) {
      if (model !== undefined && model !== this.workerModel) {
        this.ledger?.emit("reject", { label, why: `per-unit model ${model} needs the fleet-pane path (CLI transport carries one pin)` })
        this.log(`resume refused for ${label}: per-unit model ${model} needs the fleet-pane path (CLI transport carries one pin)`)
        return false
      }
      if (temperature !== undefined) {
        this.ledger?.emit("reject", { label, why: "per-unit temperature needs the fleet-pane path (the CLI transport drops it)" })
        this.log(`resume refused for ${label}: per-unit temperature ${temperature} needs the fleet-pane path (the CLI transport drops it)`)
        return false
      }
    }
    if (this.layout.tab === "new" && this.colPane) {
      const pane = this.splitForWorker(cwd)
      if (!pane) {
        this.log(`pane split failed for ${label} — no live anchor`)
        return false
      }
      const ok = this.inhabitPane(name, session.tool, pane, briefPath, cwd, model ?? this.workerModel, undefined, false, session.session_id, temperature)
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
    this.workers.add(label)
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
    return this.transport.exec("agent", "get", this.scopedFn(name)).status === 0
  }

  // completion-detection: the pane's own verdict — delegated to the
  // host, which owns the agent_status grammar (ONE parser lives
  // there; "done" folds to idle, anything else is unknown = the
  // fallback ladder).
  workerStatus(name: string): AgentStatus {
    return this.host.status(this.scopedFn(name))
  }

  reprompt(name: string, briefPath: string): boolean {
    try {
      const brief = readFileSync(briefPath, "utf8")
      const r = this.transport.exec("agent", "prompt", this.scopedFn(name), brief)
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
    // close what we opened: the fleet tab (worker panes) is this
    // orchestrator's own chrome — leftover fan-out-* tabs told the user
    // nothing about whose they were. Parked runs re-open it on continue.
    if (this.fleetTab) {
      this.transport.exec("tab", "close", this.fleetTab)
      this.log(`fleet tab ${this.fleetTab} closed`)
      this.fleetTab = null
    }
    // process-level guarantee (2026-10-17 ghost-levy incident): herdr's
    // registry can forget a pane while its agent process lives on and keeps
    // executing its brief. Anything still holding this job's run dir as its
    // world must die with the job.
    try {
      execFileSync("pkill", ["-9", "-f", this.taskDir ?? ".__never_matches__"], { timeout: 10_000 })
    } catch {
      /* no stragglers — fine */
    }
  }

  verify(): string {
    const r = this.shep("verify")
    const line = r.stdout.split("\n").find((l) => l.includes("pane-reap:"))
    return (line ?? "pane-reap: ? remaining").trim()
  }

  // Booked wait (ADR 0006), one spelling for every engine: a pane whose
  // booked session a LIVE child spur names as its spawner is idle on
  // purpose — fan-out units and coworker members both ask by name and}

  // The drain registration (ADR 5): an engine that can drain installs
  // its hook here — fan-out at runOrchestrator start, coworker at
  // birth, lab at boot (every engine does; that is the parity). The
  // door stays kind-blind: it never decides signal semantics by shape.
  //
  // Station tenancy (ADR 0016): the registration is a STACK, not a
  // slot. A hosted station's engine pushes its drain ABOVE the
  // parent's; the trap unwinds LIFO (the station ends its member
  // turns, then the parent arms its own park) so both halves run on
  // every SIGTERM. The returned disposer removes exactly that entry —
  // the engine calls it when its flight ends, and the parent's drain
  // is what remains. The pre-tenancy slot let a hosted engine erase
  // the parent's park (and the engines' `rail.drainHook = ...`
  // reach-ins made it worse); the getter makes those compile errors.
  private readonly drainStack: Array<() => void> = []

  installDrain(fn: () => void): () => void {
    this.drainStack.push(fn)
    return () => {
      const i = this.drainStack.indexOf(fn)
      if (i >= 0) this.drainStack.splice(i, 1)
    }
  }

  // LIFO over every registered drain — the trap's body, and the seam
  // tests drive directly (the lab-pause pattern).
  drainNow(): void {
    for (const fn of [...this.drainStack].reverse()) fn()
  }

  // Back-compat read of the composite drain (null when nothing is
  // registered). READ-ONLY by design: assignment was the tenancy bug.
  get drainHook(): (() => void) | null {
    return this.drainStack.length > 0 ? () => this.drainNow() : null
  }

  // Issue #123 — one write per cycle keeps the job's leadership claim
  // fresh (the engines' renew hook, ShepPort.renew).
  renew(): void {
    this.ledger?.renew()
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

  // Answer one worker's permission dialog, if it has one. The scope
  // (task dir + program roots) plus the pane's booked cwd IS the root
  // set — assembled inside the predicate, never here; context defaults
  // to the pane's booked brief. Returns the verdict:
  // "none" (no dialog), "allow", "deny", or "capped" (deny cap hit —
  // the caller finished_by or kills the worker. Allows are free: only a
  // deny pattern — wandering asks, or a hard-deny re-ask loop —
  // spends the cap).
  answerPermission(name: string): "allow" | "deny" | "none" | "capped" {
    const label = this.scopedName(name)
    const state = this.transport.exec("agent", "get", label).stdout
    if (parseAgentStatus(state) !== "blocked") return "none"
    return this.answerDialog(label)
  }

  // The dialog answer itself, keyed by the SCOPED label (cwdOf/briefOf/
  // askedCount are label-keyed). Callers pre-check blocked.
  private answerDialog(label: string): "allow" | "deny" | "capped" {
    const term = this.transport.exec("agent", "read", label).stdout
    const at = term.lastIndexOf("Permission required")
    const question = at >= 0 ? term.slice(at, at + 2000) : term.slice(-2000)
    const cwd = this.cwdOf.get(label) ?? this.taskDir
    const briefFile = this.briefOf.get(label)
    const context =
      briefFile && existsSync(briefFile) ? readFileSync(briefFile, "utf8").slice(0, 2000) : undefined
    const raw = decidePermission(
      { question, scope: this.scope, home: this.home, cwd, context },
      this.judge ?? tunedPermissionJudge(),
    )
    // Forensics first (issue #82): the ask itself belongs in the log —
    // a verdict on a mangled path was undiagnosable without it.
    this.log(`dialog ${label}: ${question.split("\n").slice(0, 3).join(" ⏎ ").slice(0, 200)}`)
    const key = `${label}|${raw.path ?? "?"}`
    const prior = this.pathAsks.get(key) ?? 0
    this.pathAsks.set(key, prior + 1)
    const verdict = escalateOnRepeat(raw, prior)
    const asked = (this.askedCount.get(label) ?? 0) + 1
    this.askedCount.set(label, asked)
    if (verdict.decision === "allow" && verdict.path) {
      // an allow spends nothing: the need was judged real (or asserted
      // by repeat ask) — a working member touching legitimately-needed
      // outside-roots paths (a vista job reading its shots) must not
      // die at the cap. The durable grant is the parent dir, but a
      // top-level path's parent is "/" — granting that whitelists the
      // disk, so the path itself is the grant (j-b6067c: /tmp -> /**).
      const parent = verdict.path.replace(/\/[^/]*$/, "")
      addWorkerRoot(cwd, parent === "" || parent === "/" ? verdict.path : parent)
      this.transport.exec("agent", "send-keys", label, "enter")
    } else {
      this.transport.exec("agent", "send-keys", label, "esc")
      // Delivery verification (issue #82): a verdict the pane cannot
      // consume strands the worker — the deny's "ask again" promise
      // can never be kept and the stall clock eats a productive pane
      // (j-8aceed). Re-check the dialog; if it survived the first esc,
      // re-send and log loudly so the postmortem sees the strand.
      const stillUp = this.transport.exec("agent", "read", label).stdout.lastIndexOf("Permission required") >= 0
      if (stillUp) {
        this.transport.exec("agent", "send-keys", label, "esc")
        this.log(`permission ${label}: dialog SURVIVED esc — re-sent esc; pane may need manual attach`)
      }
      const note = `[permission] ${verdict.message}`
      const rc = this.transport.exec("agent", "prompt", label, note)
      if (rc.status !== 0) this.pendingNote.set(label, note)
      this.denyCount.set(label, (this.denyCount.get(label) ?? 0) + 1)
    }
    this.ledger?.emit("permission", {
      member: label,
      decision: verdict.decision,
      path: verdict.path,
      ask: asked,
      // the verdict message carries the reasoning (and the jev score
      // when the judge allowed) — postmortems see WHY, not just what
      message: verdict.message,
    })
    this.log(`permission ${label} #${asked}: ${verdict.decision} ${verdict.path ?? "(no path)"} — ${verdict.message}`)
    this.say("watcher", `permission ${label} ${verdict.decision}`)
    return (this.denyCount.get(label) ?? 0) >= PERMISSION_CAP ? "capped" : verdict.decision === "allow" ? "allow" : "deny"
  }

  // Flush queued permission notes into panes that can take them (a
  // blocked or working pane refuses prompts — the note waits).
  // The queue is keyed by the SCOPED pane label; herdr is called with
  // it directly — agentState() would scope an already-scoped label
  // and ask for styler-x-x (j-a532f9).
  flushPendingNotes(): number {
    let flushed = 0
    for (const [held, note] of this.pendingNote) {
      const st = this.transport.exec("agent", "get", held).stdout
      const ps = parseAgentStatus(st)
      if (ps === "blocked" || ps === "working") continue
      if (this.transport.exec("agent", "prompt", held, note).status === 0) {
        this.pendingNote.delete(held)
        this.log(`injected queued note into ${held}`)
        flushed++
      }
    }
    return flushed
  }

  // A queued permission note waiting on this member (scoped by name)?
  // The stall guard defers a nudge-cap kill while guidance is pending —
  // the member cannot act on a message it has not received.
  hasPendingNote(name: string): boolean {
    return this.pendingNote.has(this.scopedName(name))
  }

  // -- the sweep (zen 6, rail-owned) ---------------------------------------------
  //
  // One sweep for every pane the rail holds: engines no longer choose
  // which panes get their dialogs answered — the rail answers them all
  // each tick, panes beyond any engine's list included. Engines map the
  // returned UNSCOPED names to their own consequence (fan-out finishes
  // the unit blocked, coworker ends the member, lab finishes the mock).
  // A capped pane no engine owns — not born through spawnWorker — is
  // retired HERE: an untracked privileged mind dies at the cap, it
  // never hangs on a dialog nobody watches. Queued notes ride every
  // tick.

  tickPrivilege(): { answered: Set<string>; capped: Set<string> } {
    const answered = new Set<string>()
    const capped = new Set<string>()
    for (const label of [...this.mine]) {
      const st = this.transport.exec("agent", "get", label).stdout
      if (parseAgentStatus(st) !== "blocked") continue
      const verdict = this.answerDialog(label)
      const name = this.unscopedOf.get(label) ?? label
      answered.add(name)
      if (verdict !== "capped") continue
      capped.add(name)
      if (this.workers.has(label)) continue
      const pane = this.paneOf.get(label)
      if (pane) this.transport.exec("pane", "close", pane)
      this.shep("retire", label)
      this.mine.delete(label)
      this.log(`untracked pane ${label} hit the deny cap — retired by the sweep`)
    }
    this.flushPendingNotes()
    return { answered, capped }
  }

  // -- lab board layout (lanes.ts) ---------------------------------------------

  // Engines prompt panes by name; the runner behind it is the seam.
  promptAgent(name: string, text: string): RunnerResult {
    return this.host.prompt(this.scopedFn(name), text)
  }

  // Latest session message whose error.type is a provider budget fault.
  // OpenCode puts this on the message (`provider.rate-limit`, status 429),
  // not on the pane. Returns the message id so a stale fault is not re-judged.
  latestSessionFault(sessionId: string, cwd: string): { id: string; type: string } | null {
    const memo = this.faultMemo.get(sessionId)
    if (memo && Date.now() - memo.at < 10_000) return memo.hit
    const hit = this.probeSessionFault(sessionId, cwd)
    this.faultMemo.set(sessionId, { at: Date.now(), hit })
    return hit
  }

  private probeSessionFault(sessionId: string, cwd: string): { id: string; type: string } | null {
    const r = spawnSync("opencode", ["api", "GET", `/api/session/${sessionId}/message`], {
      cwd,
      encoding: "utf8",
      timeout: 20_000,
    })
    if ((r.status ?? 1) !== 0 || !r.stdout) return null
    let data: Array<{ id?: string; time?: { created?: number }; error?: { type?: string; status?: number } }>
    try {
      data = JSON.parse(r.stdout).data
    } catch {
      return null
    }
    if (!Array.isArray(data) || data.length === 0) return null
    const latest = [...data].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0))[0]
    if (!latest?.id || !isProviderFault(latest.error)) return null
    return { id: latest.id, type: latest.error?.type ?? "provider.rate-limit" }
  }

  // Switch the model inside the live session. A resumed session keeps
  // its old provider; the sandbox opencode.json does not override it.
  switchSessionModel(sessionId: string, model: string, cwd: string): { ok: boolean; why?: string } {
    const ref = parseModelRef(model)
    if (!ref) return { ok: false, why: `not a provider/model: ${model}` }
    const r = spawnSync(
      "opencode",
      ["api", "POST", `/api/session/${sessionId}/model`, "-d", JSON.stringify({ model: ref })],
      { cwd, encoding: "utf8", timeout: 20_000 },
    )
    if ((r.status ?? 1) !== 0) return { ok: false, why: `session model rc=${r.status}: ${(r.stdout ?? r.stderr ?? "").slice(0, 120)}` }
    return { ok: true }
  }

  renamePane(pane: string, name: string): void {
    this.transport.renamePane(pane, name)
  }

  closePane(pane: string): void {
    this.transport.closePane(pane)
  }

  // A held member mints its session on its first prompt — book it
  // shortly (ADR 5), so a continue resumes its conversation. Marker
  // first, newest-wins as the last resort (a session always books).
  // The latest booked session for a worker NAME (the fan-out fault
  // lane's session lookup — the same shape the conversation engine
  // inlines for members): panes book under the unit name, transcripts
  // carry the host session id, the newest born wins.
  //
  // gate-r4 principles-24 — the identity is DUAL-SPELLED by design:
  // the ledger's unit column attaches the spawn name verbatim
  // (`w-<id>` — the cycle spawns w-${unit.id}) while the fault lane
  // and the birth judge speak the BARE unit id. The lookup answers
  // both spellings (the usageOf/briefOf dual-get pattern) — a miss
  // here computed fault=null for every fan-out pane and left the
  // just-wired lane dead while its claim said "forwarded".
  bookedSessionOf(name: string): string | undefined {
    if (!this.ledger) return undefined
    // THE ONE SPELLING (gate-r9 tests-300): fan-out panes attach the
    // spawn name verbatim — the cycle passes `w-${unit.id}` at BOTH
    // spawn sites (orchestrator spawn and resumeSpawn) — so the w-
    // form is not a variant, it is THE form. The bare disjunct was
    // pure collision surface: a unit literally named w-api made
    // lookup("api") answer w-api's panes and lookup("w-api") answer
    // api's — the momentum-18 class surviving one spelling later.
    const latest = this.ledger.job.panes
      .filter((p) => p.unit === `w-${name}` && p.transcript)
      .sort((a, b) => a.born.localeCompare(b.born))
      .pop()
    return latest?.transcript?.session_id
  }

  // The birth judge's second look (j-4a0009): bookSessionLate ran at
  // +5s only; a pane whose agent boarded slowly (or whose booking
  // raced) deserves one IMMEDIATE re-resolve before it is judged dead
  // at birth. Same resolution bookSessionLate uses, no timer.
  // gate-r4 principles-24: the spawn state (cwdOf/kindOf/briefOf) is
  // keyed by the pane label scopedFn(`w-<id>`) while the judge passes
  // the bare id — resolve BOTH spellings, and remember which one hit
  // (setSession must speak the pane's own label).
  tryBookSession(name: string): string | undefined {
    // THE ONE SPELLING (gate-r9 tests-300): spawn state (cwdOf/kindOf/
    // briefOf) is keyed at spawn under scopedFn(`w-${id}`) — BOTH spawn
    // sites pass the w- form — so the re-resolve scopes exactly that.
    // The dual bare/withW resolution was the w-prefixed-id collision
    // (unit "w-api" vs unit "api") one layer down.
    const label = this.scopedName(`w-${name}`)
    const briefPath = this.briefOf.get(label) ?? this.briefOf.get(name)
    const marker = briefPath ? dirname(briefPath) : undefined
    const cwd = this.cwdOf.get(label)
    const kind = this.kindOf.get(label)
    if (!cwd || !kind) return undefined
    const since =
      this.ledger?.job.panes
        .filter((p) => p.label === label)
        .sort((a, b) => a.born.localeCompare(b.born))
        .map((p) => p.born)
        .pop() ?? new Date().toISOString()
    // gate-r9 tests-300: when a MARKER exists, it is the discriminator —
    // resolveOpencode's own doctrine (transcripts.ts: no candidate carries
    // the marker → NO id; the caller retries) forbids the marker-less
    // newest-wins fallback, which cross-booked a dash-prefix sibling's
    // session onto this pane's row. The fallback survives only for the
    // no-brief shape (nothing to discriminate with).
    const sid = marker
      ? this.resolveMarkedSession(kind, cwd, since, marker)
      : this.resolveLiveSession(kind, cwd, since)
    if (sid) this.ledger?.setSession(label, sid)
    // the resolvers speak null for "nothing"; the seam's contract is
    // undefined (tests-601: a null leak made a miss look like a value
    // to strict-equal callers)
    return sid ?? undefined
  }

  bookSessionLate(name: string, kind: string, cwd: string, since: string): void {    setTimeout(() => {
      const briefPath = this.briefOf.get(this.scopedName(name)) ?? this.briefOf.get(name)
      const marker = briefPath ? dirname(briefPath) : undefined
      // the same marker doctrine as tryBookSession (gate-r9 tests-300):
      // a marker exists → it is the discriminator; a null marker-resolve
      // means "not resolvable yet" (the message race resolveOpencode
      // documents) — the marker-less newest-wins fallback cross-booked
      // siblings sharing a cwd. The fallback survives only with no brief.
      const sid = marker
        ? this.resolveMarkedSession(kind, cwd, since, marker)
        : this.resolveLiveSession(kind, cwd, since)
      if (sid) this.ledger?.setSession(this.scopedFn(name), sid)
    }, 5_000).unref()
  }

  layoutOf(pane: string): { area: { width: number; height: number }; panes: { pane_id: string; rect: { x: number; y: number; width: number; height: number } }[] } | null {
    const r = this.transport.exec("pane", "layout", "--pane", pane)
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
        this.transport.exec("pane", "resize", "--pane", ids[i + 1]!, "--direction", dir, "--amount", String(amount))
        moved = true
        break
      }
      if (!moved) return
    }
  }

  openShell(dir: string, label: string): string | null {
    const r = this.transport.exec("tab", "create", "--label", label.slice(0, 40), "--cwd", dir, "--no-focus")
    const root = jsonAt(r.stdout, (d) => (d as { result?: { root_pane?: { pane_id?: string } } }).result?.root_pane?.pane_id ?? null)
    if (!root) return null
    const shell = this.splitPane(root, "right", dir, 0.5)
    if (!shell) return null
    this.transport.exec("pane", "close", root)
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
      if (!pane) return this.freshRole(board, role, dir)
      const next = note(board, placed, pane)
      this.equalize(next.tabs[placed.tab].lanes.map((lane) => lane.panes[0]!), "x")
      return { board: next, pane }
    }
    const lane = board.tabs[placed.tab].lanes[placed.lane]
    const from = lane.panes[lane.panes.length - 1]!
    const pane = this.splitPane(from, "down", dir, 0.5)
    if (!pane) return this.freshRole(board, role, dir)
    const next = note(board, placed, pane)
    this.equalize(next.tabs[placed.tab].lanes[placed.lane].panes, "y")
    return { board: next, pane }
  }

  // The recorded anchor was already closed (a failed start ghost-clears
  // its pane). A null split must not skip the member — open a new tab.
  private freshRole(board: Board, role: string, dir: string): { board: Board; pane: string | null } {
    const pane = this.openShell(dir, role)
    if (!pane) return { board, pane: null }
    this.log(`split anchor dead for ${role} — opened a fresh tab`)
    return { board: note(board, { kind: "overflow-tab", role }, pane), pane }
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
    this.transport.exec("pane", "rename", pane, "verbose")
    const child = spawn("herdr", ["pane", "run", pane, "tail", "-n", "+1", "-F", path], {
      detached: true,
      stdio: "ignore",
    })
    child.on("error", () => {})
    child.unref()
    this.say("rail", "verbose tab open")
  }

  closeVerbose(): void {
    if (this.verbosePane) this.transport.exec("pane", "close", this.verbosePane)
  }

  // -- door protocol: signals and the engine epilogue ----------------------------
  //
  // One epilogue for every door (was copy-pasted per bin): run the
  // engine, then park on null, finish on a report, abort+exit-code on
  // a throw. Signals are KIND-BLIND (OPTIMUM §2): SIGINT always
  // aborts; SIGTERM drains through the engine's registered drain hook
  // (installDrain — every engine installs one: fan-out at
  // runOrchestrator start, coworker at birth, lab at boot). Sessions
  // stay booked either way; the door never branches on shape to
  // decide signal semantics.

  trapSignals(): void {
    process.on("SIGINT", () => {
      this.ledger?.abort("signal SIGINT", this.mine.size)
      process.exit(0)
    })
    process.on("SIGTERM", () => {
      if (this.drainHook) return this.drainHook()
      this.ledger?.abort("signal SIGTERM", this.mine.size)
      process.exit(0)
    })
  }

  async run(engine: () => Promise<Report | null>): Promise<number> {
    try {
      const report = await engine()
      if (!report) {
        // parked (ADR 5): the rail drained to its boundary and retired
        // its panes — book the pause; a typed continue brings the Job back.
        this.ledger?.pause("drained", this.ledger.job.panes.filter((p) => p.died === undefined).length)
        this.log(`parked: paused — continue with: whitehartlane continue ${this.ledger?.job.id ?? "<jid>"}`)
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
      // Close what we opened even on the way down (j-5701b2: the fatal
      // left fan-out-<jid> chrome AND a live worker pane behind, in a
      // workspace the levy never looked at). Best-effort on purpose —
      // a fatal caused by herdr itself must not mask the original story.
      try {
        this.retireAll()
      } catch {
        this.log(`post-fatal cleanup incomplete — fleet tab ${this.fleetTab ?? "(none)"} may linger`)
      }
      this.wake("fan-out", "blocked", `orchestrator died: ${this.taskDir}/orchestrator.log`)
      return 1
    }
  }
}

// local aliases keep the store's record shapes out of the public face
type ResumePointerLike = { tool: string; session_id?: string; cwd: string }
type PaneRecordLike = { unit?: string; born: string; transcript?: { tool: string; session_id?: string; cwd?: string } }
