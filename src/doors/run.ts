import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"
import { expandHome, scopeCovers, scopeFromDir } from "../core/permission.ts"
import { HookError, gradeSmoke, loadManifest, probeHooks } from "./hooks.ts"
import { workflowKind, type WorkflowKind } from "../core/workflow-kind.ts"
import { admitAnotherJob, admitFanOut } from "../jev/policy.ts"
import { checkpoint, readState } from "../core/state.ts"
import { findJobByDir } from "../adapters/store.ts"
import {
  contentHashOf,
  duplicateStageIds,
  ensureProject,
  labelsFor,
  registerSpur,
  relSourceOf,
  scopeRootOf,
  spurIdOf,
  validateSpurId,
  type SpurIdentity,
} from "./project.ts"
import {
  appendEvent,
  createJob,
  eventsPath,
  findOrOpenSession,
  findSessionByHost,
  findSessionBySpur,
  listJobs,
  loadJob,
  openSession,
  bookingStale,
  orphanJob,
  sessionsRoot,
  stampSpurKey,
  type JobRecord,
  type Provenance,
  type SessionRecord,
  type SpawnerPointer,
} from "../adapters/store.ts"

// ADR 0006: --from <tool>:<session-id> books the spawning levy as the
// checkpoint — the Job will wake it exactly once at the end. Run from
// inside a herdr pane (or with --pane <id>), the pane is booked too:
// the wake's strongest address, captured at the one moment session and
// pane are both known. No pane (outside herdr) is a state, not an
// error — the ladder falls to registration/fork as before.
export function spawnerFromArgs(args: string[], env: NodeJS.ProcessEnv = process.env): SpawnerPointer | null {
  const fromIdx = args.indexOf("--from")
  const fromVal = fromIdx !== -1 ? args[fromIdx + 1] : undefined
  if (!fromVal || !/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(fromVal)) return null
  const i = fromVal.indexOf(":")
  const paneIdx = args.indexOf("--pane")
  const pane = paneIdx !== -1 ? args[paneIdx + 1] : env.HERDR_PANE_ID
  return {
    tool: fromVal.slice(0, i),
    session_id: fromVal.slice(i + 1),
    since: new Date().toISOString(),
    ...(pane ? { pane } : {}),
  }
}

export type RunReady = {
  ok: true
  job: JobRecord
  log: string
  trace: string
  kind: WorkflowKind
  warnings: string[]
}

export type RunRefused = {
  ok: false
  why: string
  code: 1 | 2
}

function absolutize(cmd: string, source: string): string {
  return cmd
    .split(/\s+/)
    .map((token) => {
      if (token.startsWith("/") || token.startsWith("-")) return token
      const candidate = resolve(source, token)
      return existsSync(candidate) ? candidate : token
    })
    .join(" ")
}

export function stageRun(source: string, store: string): void {
  mkdirSync(store, { recursive: true })
  const manifest = loadManifest(source)
  // #196 / ADR 0016 slice 3: hooks/ TRAVELS. The staged program is
  // self-contained — every hook command (verdict included, the seam
  // the interview taught: a relative verdict.sh doomed the run and the
  // members hallucinated repairs) resolves against the RUN dir's own
  // hooks, never the source's.
  const hooksSrc = join(source, "hooks")
  if (existsSync(hooksSrc)) cpSync(hooksSrc, join(store, "hooks"), { recursive: true })
  let raw = readFileSync(join(source, "workflow.toml"), "utf8")
  const cmds = [
    manifest.hooks.units,
    manifest.hooks.grade,
    manifest.hooks.counts,
    manifest.hooks.verdict,
    manifest.detectors?.signal,
    manifest.detectors?.end,
  ]
  for (const cmd of cmds) {
    if (cmd) raw = raw.replaceAll(cmd, absolutize(cmd, store))
  }
  // ADR 0007 wake steps: a child program's folder is staged absolute
  // against the source tree — the staged manifest in the OS store must
  // point at the program the author declared, wherever the run lives
  raw = raw.replace(/(^(\s*)folder\s*=\s*")([^"]+)(")/gm, (m, pre, _ws, path, post) => {
    if (path.startsWith("/")) return m
    const abs = resolve(source, path)
    return existsSync(abs) ? `${pre}${abs}${post}` : m
  })
  writeFileSync(join(store, "workflow.toml"), raw)
  copyBeside(source, store)
}

function copyBeside(source: string, store: string): void {
  // the question bank stages into the SHARED data/ shelf (ADR 0016
  // slice 5: a member's write scope covers data/ and its own outbox
  // only — the bank is the shelf's one append-only file)
  const bank = join(source, "questions.toml")
  if (existsSync(bank)) {
    mkdirSync(join(store, "data"), { recursive: true })
    writeFileSync(join(store, "data", "questions.toml"), readFileSync(bank))
  }
  for (const name of ["actor.md", "task.txt", "roots.txt", "project.json", "contract.toml"]) {
    const file = join(source, name)
    if (existsSync(file)) writeFileSync(join(store, name), readFileSync(file))
  }
  // a program may carry a data/ folder — the files the briefs and hooks
  // read; it is staged beside the spur so the run is self-contained
  const data = join(source, "data")
  if (existsSync(data)) cpSync(data, join(store, "data"), { recursive: true })
  // a coworker program carries member briefs in members/<name>.md
  const members = join(source, "members")
  if (existsSync(members)) cpSync(members, join(store, "members"), { recursive: true })
  // ── the re-levy fold (momentum-3, r11; reshaped by r12) ────────────
  // The manual's hard rule — "re-levy the SAME program dir: the
  // settled fold spares done units" — serves exactly ONE intent: a
  // prior booking of THIS program dir died mid-chain. r12's three
  // findings pinned the fold's true preconditions:
  //   momentum-5/principles-4 — a COMPLETED prior run must not fold
  //     (an identical-args re-review and the drill's second run want
  //     fresh minds; replaying verdicts is the four-late death again)
  //   momentum-4 — folded verdicts must be the new run's OWN hooks'
  //     verdicts: hooks/ joins the identity, so changed hooks never
  //     match and the unit re-runs
  //   path, not content: kinship is the same program DIR re-levied,
  //     never byte-identical strangers
  // The precondition is conservative by design: a prior with no failed
  // rows (a unit killed before its first card) does not fold — the
  // full rail re-runs. Wrong-fresh beats wrong-replay.
  const hooksHash = existsSync(join(source, "hooks"))
    ? contentHashOf(join(source, "hooks"))
    : ""
  // EVERY program input copyBeside stages must join the identity
  // (r13 principles-5/questions-1: questions.toml, task.txt, actor.md,
  // roots.txt, project.json, contract.toml staged beside the program
  // but hashed nowhere — a done unit folded forward across edited
  // inputs, run 2's ledger claiming a settle its own inputs never
  // made). A missing input hashes as its name only.
  const beside = ["questions.toml", "task.txt", "actor.md", "roots.txt", "project.json", "contract.toml"]
    .map((n) => {
      const f = join(source, n)
      if (!existsSync(f)) return `${n}:`
      return `${n}:${createHash("sha1").update(readFileSync(f)).digest("hex")}`
    })
    .join("|")
  const identity = {
    source: resolve(source),
    workflow: createHash("sha1").update(readFileSync(join(source, "workflow.toml"))).digest("hex"),
    hooks: hooksHash,
    data: existsSync(join(source, "data")) ? contentHashOf(join(source, "data")) : "",
    members: existsSync(members) ? contentHashOf(members) : "",
    beside,
  }
  writeFileSync(join(store, ".whl-program"), JSON.stringify(identity))
  const prior = newestPriorRun(store, identity)
  // the fold's OWN precondition, decided (r23 momentum-12): the prior
  // booking must be DEAD (orphaned/aborted/retired) — a merely PAUSED
  // (parked) run's prescribed recovery is its own 'whl continue', and
  // folding its done units beside that rebirth drives two live chains
  // on one program. No job record (legacy/manual staging) → fold.
  if (prior) {
    // a LIVE prior booking blocks the fold — running/paused WITH a
    // runner pid (its own recovery owns the program). A pid-less
    // "running" record is a checkpoint-minted trace shell (the cycle
    // mints one per staged dir — it never spawned anything) and must
    // not block (r23 momentum-12's own repro shapes this).
    const priorJob = findJobByDir(prior)
    const liveBlocker =
      priorJob &&
      (priorJob.state === "running" || priorJob.state === "paused") &&
      !!priorJob.pid
    if (liveBlocker) {
      logRunNote(store, `fold: prior booking ${priorJob.id} is ${priorJob.state} with live pid ${priorJob.pid} — not dead; nothing folds (its own recovery owns the program)`)
      return
    }
  }
  if (prior) {
    const settled = readState(prior)
    // "completed" is per-shape and needs the prior's OWN unit count
    // (r13 momentum-6: the fallback total = done+failed declared a
    // fold-carrying prior with no units snapshot 'completed' and the
    // chain's second re-levy folded nothing):
    //   a REVIEW run completed when its cold gate wrote a verdict;
    //   a GENERIC run completed when its units.jsonl exists and every
    //   unit settled. No units snapshot → not completed → the fold
    //   fires (unfinished by default — wrong-fresh beats wrong-replay).
    const priorVerdict = join(prior, "data", "review", "verdict.json")
    const unitsJsonl = join(prior, "units.jsonl")
    const unitsJsonlPresent = existsSync(unitsJsonl)
    const total = unitsJsonlPresent
      ? readFileSync(unitsJsonl, "utf8").trim().split("\n").filter(Boolean).length
      : 0
    const settledCount = settled.done.length + settled.failed.length
    const isReview = existsSync(join(prior, "data", "review"))
    const completed = isReview
      ? existsSync(priorVerdict)
      : unitsJsonlPresent && settledCount >= total
    if (completed) {
      logRunNote(store, "fold: prior run completed — fresh minds, nothing folded")
    } else {
      // the fold's screen is the DELIVERABLE, not the directory (gate-r15
      // momentum-31): a done card plus an existing dir proves nothing —
      // the torn-prior shape (dir present, result.md gone to a crash
      // mid-copy or a cleanup hand) folded an INCOMPLETE settle that the
      // new run's own grade hook would fail. result.md present and
      // non-empty, or the unit re-runs (wrong-fresh beats wrong-replay).
      const done = settled.done.filter((u) => {
        try {
          return statSync(join(prior, "units", u, "result.md")).size > 0
        } catch {
          return false
        }
      })
      for (const u of done) {
        // the fold is an OPTIMIZATION (r26 tests-1): an unreadable unit
        // dir must never abort the booking. cpSync-recursive is
        // NATIVELY fatal on an unreadable dir (libc++ filesystem_error
        // terminates the process — a JS try/catch cannot see it), so
        // the dir is PROBED with readdirSync first (a JS-catchable
        // EACCES); a unit that fails the probe or the copy simply
        // re-runs — no phantom booking, no native abort.
        try {
          readdirSync(join(prior, "units", u))
          cpSync(join(prior, "units", u), join(store, "units", u), { recursive: true })
          checkpoint(store, `unit:${u}`, "ok", `folded from prior run ${prior}`, u)
        } catch (err) {
          logRunNote(store, `fold: unit ${u} unreadable (${err instanceof Error ? (err as NodeJS.ErrnoException).code ?? err.message.split("\n")[0] : String(err)}) — re-running it`)
        }
      }
      if (done.length > 0) logRunNote(store, `fold: ${done.length} done unit(s) spared from ${prior}`)
    }
  }
}

// the fold's receipt, beside the program — a note, never a verdict
function logRunNote(store: string, note: string): void {
  appendFileSync(join(store, "fold.log"), `${new Date().toISOString()} ${note}\n`)
}

// the newest earlier staged run of the SAME program (identity marker
// match), excluding the store being staged — the re-levy fold's source
function newestPriorRun(store: string, identity: { source: string; workflow: string; hooks: string; data: string; members: string; beside: string }): string | null {
  const root = sessionsRoot()
  if (!existsSync(root)) return null
  const want = JSON.stringify(identity)
  let best: { dir: string; m: number } | null = null
  for (const sid of readdirSync(root)) {
    const jdir = join(root, sid, "jobs")
    if (!existsSync(jdir)) continue
    for (const jid of readdirSync(jdir)) {
      const run = join(jdir, jid, "run")
      const marker = join(run, ".whl-program")
      if (!existsSync(marker)) continue
      if (readFileSync(marker, "utf8") !== want) continue
      if (resolve(run) === resolve(store)) continue
      let m = 0
      try {
        m = statSync(marker).mtimeMs
      } catch {
        continue
      }
      if (!best || m > best.m) best = { dir: run, m }
    }
  }
  return best?.dir ?? null
}

// The lineage resolution, ONE spelling (deep seam: book() and the
// tests ask the same question). Lookup order: host binding by dir
// (continuity — a pre-lineage session is adopted and stamped, never
// forked), then the lineage key, then create. The ONE refusal: same
// (scope_root, spur_id) answering a different rel_source — two program
// dirs wearing one name inside one worktree would silently merge two
// step histories. Different scopes never compare.
export function resolveLineageSession(
  dir: string,
  spurId: string,
): { session: SessionRecord } | { refuse: string } {
  const scopeRoot = scopeRootOf(dir)
  const relSource = relSourceOf(dir, scopeRoot)
  const byHost = findSessionByHost("whitehartlane", dir)
  if (byHost) {
    if (!byHost.spur_key) stampSpurKey(byHost, { scope_root: scopeRoot, spur_id: spurId, rel_source: relSource })
    return { session: byHost }
  }
  const bySpur = findSessionBySpur(scopeRoot, spurId)
  if (bySpur) {
    if (bySpur.spur_key && bySpur.spur_key.rel_source !== relSource) {
      return {
        refuse: `spur_id "${spurId}" in scope ${scopeRoot} is already claimed by ${bySpur.spur_key.rel_source} (session ${bySpur.id}); this run comes from ${relSource} — rename one spur_id, or run it from its own worktree`,
      }
    }
    return { session: bySpur }
  }
  const session = openSession({ cwd: dir, host: { tool: "whitehartlane", session_id: dir } })
  stampSpurKey(session, { scope_root: scopeRoot, spur_id: spurId, rel_source: relSource })
  return { session }
}

// Provenance, best-effort and never a gate: which whl ran it (the
// door's own commit), which model the workflow declares, and which
// commit the program's repo sat on. The f313a23c pair — two runs, one
// content_hash, different work — taught why: the program text alone
// does not identify a run; its surroundings do.
function provenanceOf(dir: string): Provenance {
  const p: Provenance = {}
  try {
    const wf = loadManifest(dir).workflow as Record<string, unknown>
    if (typeof wf.model === "string") p.model = wf.model
    if (typeof wf.worker_kind === "string") p.worker_kind = wf.worker_kind
  } catch {
    /* a scaffolded program has no manifest — nothing to record */
  }
  try {
    const doorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
    p.door_commit = execFileSync("git", ["-C", doorRoot, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    /* a released install is not a git checkout */
  }
  try {
    p.repo_head = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    /* program folders often sit outside any repo */
  }
  return p
}

function book(
  dir: string,
  kind: WorkflowKind,
  task: string,
  slots: number,
  stage: (store: string) => void,
  preWarnings: string[] = [],
): RunReady | RunRefused {
  const taskFile = join(dir, "task.txt")
  if (existsSync(taskFile)) {
    const line = readFileSync(taskFile, "utf8").split("\n")[0]?.trim()
    if (line) task = line
  }
  const admission = admitFanOut({ manifestResolved: true, slots })
  if (!admission.admit) {
    return { ok: false, why: admission.why ?? "policy rejected", code: 1 }
  }
  const warnings: string[] = [...preWarnings]
  // ── spur identity FIRST — a session is the spur's lineage, so the
  // lineage key must exist before any session is opened. project pid
  // (minted once into project.json), spur_id (explicit, else the name,
  // else a hashed id + a loud warning), the source content hash as the
  // version, branch/worktree as labels. Paths are never identity;
  // worktrees copy project.json and combine.
  const proj = ensureProject(dir)
  if (proj.minted) warnings.push(`no project.json in ${dir} — minted ${proj.pid} and wrote it there`)
  const spurId = spurIdOf({
    spurId: (() => {
      try {
        return loadManifest(dir, (message) => warnings.push(message)).workflow.spur_id
      } catch {
        return undefined
      }
    })(),
    name: task,
    toml: (() => {
      try {
        return readFileSync(join(dir, "workflow.toml"), "utf8")
      } catch {
        return task
      }
    })(),
  })
  if (spurId.derived) {
    warnings.push(`no spur_id (and no name) in ${dir} — derived ${spurId.spurId} from content; define workflow.spur_id to group runs`)
  } else {
    const bad = validateSpurId(spurId.spurId)
    if (bad) return { ok: false, why: bad, code: 1 }
  }
  const dupStages = duplicateStageIds(dir)
  if (dupStages.length > 0) {
    return { ok: false, why: `duplicate stage id(s) in workflow.toml: ${dupStages.join(", ")} — rename one`, code: 1 }
  }
  const version = contentHashOf(dir)
  const dup = registerSpur(proj.pid, spurId.spurId, version, dir)
  if (dup) warnings.push(dup)
  // ── the session is the spur's lineage, scoped by the commissioning
  // worktree (the Airflow dag_id rule, scoped: uniqueness is only ever
  // enforceable per worktree, because worktrees copy program folders).
  const lineage = resolveLineageSession(dir, spurId.spurId)
  if ("refuse" in lineage) return { ok: false, why: lineage.refuse, code: 1 }
  const session = lineage.session
  // momentum-8 (r15) + the r16 probe findings: a SIGKILLed
  // orchestrator leaves its Job reading state:"running" forever, and
  // THE BOOKING PROBE is orphanJob's production caller — with the
  // store's canonical oracle (pidAlive: EPERM and unparseable pids
  // count ALIVE) and a booking grace for the window between
  // createJob and the runner's pid event (r16 tests-10: that window
  // is the NORMAL shape of every booking — a young pid-less record
  // is a live intent, never an orphan).
  for (const job of listJobs(session.id)) {
    // THE single-act law (the sweep's own twin ceremony): re-read the
    // record from disk before orphaning — a concurrent `whl continue`
    // may have revived it between this snapshot and the write (r18
    // momentum-1: the probe clobbered a revived record to orphaned
    // from its stale snapshot). The fresh record answers twice:
    // still running, still stale → orphan.
    const fresh = loadJob(session.id, job.id) ?? job
    if (fresh.state !== "running") continue
    if (bookingStale(fresh, Date.now())) {
      orphanJob(fresh, `booking probe: running Job is stale (pid ${fresh.pid ?? "none"} — dead or past the booking grace)`, fresh.panes?.length ?? 0)
    }
  }
  const running = listJobs(session.id).filter((job) => job.state === "running").length
  const another = admitAnotherJob(running)
  if (!another.admit) {
    appendEvent(session.id, { actor: "cli", kind: "reject", why: another.why, workflow: kind })
    return { ok: false, why: another.why ?? "a job is already running", code: 1 }
  }
  // Issue #121 — the staging probe: grammar-check the hooks this run
  // will actually call, on sample inputs, BEFORE the job is booked or
  // any pane is born. j-64e035: a counts hook that cannot speak the
  // protocol was invisible until report time — 79 minutes of clean
  // work, then a fatal. The probe refuses at the door, where the fix
  // costs one line of toml instead of a rerun. A scaffolded program
  // (no toml) has nothing to probe — the defaults are rail-owned.
  if (existsSync(join(dir, "workflow.toml"))) {
    try {
      const manifest = loadManifest(dir)
      const refusals = probeHooks(dir, manifest)
      if (refusals.length > 0) {
        appendEvent(session.id, { actor: "cli", kind: "reject", why: `hook probe: ${refusals[0]}`, workflow: kind })
        return { ok: false, why: `hook probe refused: ${refusals.join("; ")}`, code: 1 }
      }
    } catch (err) {
      // prepareRun already surfaces manifest faults; one
      // that slips through to here is a door refusal, never a pass
      return { ok: false, why: err instanceof Error ? err.message : String(err), code: 1 }
    }
  }
  const spur = {
    project: proj.pid,
    project_name: proj.name,
    spur_id: spurId.spurId,
    content_hash: version,
    source: dir,
    labels: labelsFor(dir),
  }
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: kind,
    task,
    runDir: true,
    spur,
    provenance: provenanceOf(dir),
  })
  stage(job.dir)
  appendEvent(session.id, { actor: "cli", kind: "admit", jid: job.id, workflow: kind })
  return { ok: true, job, log: join(job.dir, "orchestrator.log"), trace: eventsPath(session.id), kind, warnings }
}

// Issue #51: a program whose briefs name paths no root covers is a
// manifest-level mismatch — better refused at the door than discovered
// by the worker dying mid-run (j-a532f9: a missing roots.txt turned
// every target-tree touch into a jev gray-zone ask). The coverage
// question is the canonical predicate's (permission.ts scopeFromDir /
// scopeCovers): the same sanitized, tilde-expanded roots the rail will
// enforce — what the door admits is exactly what the run allows (a
// hard-deny root is stripped at scope construction, so a brief naming
// its paths is refused here, not silently hard-denied mid-run — #77 at
// both boundaries now).
// #205 — the deliverable declaration reader: contract.toml's
// [[contract.deliverables]] (name + path + kind). null = no
// contract.toml; the door refuses both null and empty.
function deliverablesOf(source: string): { name: string; path: string }[] | null {
  const file = join(source, "contract.toml")
  if (!existsSync(file)) return null
  try {
    const raw = parseToml(readFileSync(file, "utf8")) as { contract?: { deliverables?: { name?: unknown; path?: unknown }[] } }
    const list = raw.contract?.deliverables ?? []
    return list
      .filter((d) => typeof d?.name === "string" && typeof d?.path === "string" && d.path.length > 0)
      .map((d) => ({ name: String(d.name), path: String(d.path) }))
  } catch {
    return null
  }
}

function uncoveredBriefPaths(source: string): string[] {  const scope = scopeFromDir(source)
  const texts: string[] = []
  for (const name of ["task.txt", "actor.md"]) {
    const f = join(source, name)
    if (existsSync(f)) texts.push(readFileSync(f, "utf8"))
  }
  const membersDir = join(source, "members")
  if (existsSync(membersDir)) {
    for (const f of readdirSync(membersDir)) {
      if (f.endsWith(".md")) texts.push(readFileSync(join(membersDir, f), "utf8"))
    }
  }
  const uncovered = new Set<string>()
  for (const text of texts) {
    for (const raw of text.match(/~?\/[A-Za-z0-9._~+-]+(?:\/[A-Za-z0-9._~+-]+)+/g) ?? []) {
      const p = expandHome(raw)
      if (scopeCovers(scope, p)) continue
      if (!existsSync(p)) continue // to-be-created scratch is not a boundary
      uncovered.add(p)
    }
  }
  return [...uncovered]
}

// #200 slice 7 / #68: the admission CHECK — every program screen the
// door runs (retired step file, grammar, grade smoke, brief paths,
// stage shape, deliverables), and NOTHING minted: no session opened, no
// job row, no staging. The phantom incident: prepareRun-as-check booked
// a running job that then blocked the next levy (three probe rows in
// one session). The booking ceremony (lineage, slots, hook probes)
// stays book-time — those screens own booking state by design.
export type RunCheck = { ok: true; kind: WorkflowKind; warnings: string[] } | RunRefused

export function prepareRun(folder: string, opts: { check?: boolean } = {}): RunReady | RunCheck | RunRefused {
  const dir = resolve(folder)
  // ADR 0014 slice 2: the spur step file no longer admits. Refusal
  // beats silence — the door names the fix (a stage chain), whether the
  // retired file is named directly or sits in the folder.
  const retiredStepFile =
    basename(dir) === "spur.mjs" ||
    basename(dir) === "dag.mjs" ||
    existsSync(join(dir, "spur.mjs")) ||
    existsSync(join(dir, "dag.mjs"))
  if (retiredStepFile) {
    return {
      ok: false,
      why: 'the spur step file is retired (ADR 0014) — a program is workflow.toml with [[stage]] entries; the experiment is a stage with topology = "lab" (docs/STAGES.md)',
      code: 1,
    }
  }
  if (!existsSync(join(dir, "workflow.toml"))) {
    return { ok: false, why: `no workflow.toml in ${dir}`, code: 1 }
  }
  let slots = 2
  let task = basename(dir)
  let kind: WorkflowKind = "fan-out"
  let stages: unknown
  try {
    kind = workflowKind(readFileSync(join(dir, "workflow.toml"), "utf8"))
    const manifest = loadManifest(dir)
    slots = manifest.workflow.slots ?? 2
    task = manifest.workflow.name
    stages = manifest.stages
    // Admission smoke (#144): a grade hook that declares --check runs
    // ONCE here — a broken hook dies before the run, not two seconds
    // after the worker finishes. The arm-e night paid 4 full attempts
    // to discover a 13ms exit-127 the check catches in 50ms.
    const smoke = gradeSmoke(dir, manifest)
    if (smoke.kind === "refuse") {
      return {
        ok: false,
        why: `grade hook failed its own --check — fix it before booking:\n${smoke.output}`,
        code: 1,
      }
    }
  } catch (err) {
    const why = err instanceof HookError ? err.message : err instanceof Error ? err.message : String(err)
    return { ok: false, why, code: 1 }
  }
  // #51: briefs naming existing paths outside every root are the
  // door's to catch — the alternative is the worker discovering it by
  // dying (j-a532f9)
  const uncovered = uncoveredBriefPaths(dir)
  if (uncovered.length > 0) {
    return {
      ok: false,
      why: `briefs name existing paths no root covers: ${uncovered.join(", ")} — add them to roots.txt (or drop them from the briefs)`,
      code: 1,
    }
  }
  // ADR 0014: a stage-less fan-out declares no workers (the units hook
  // is refused at load) — refuse at the door, before anything is booked
  // (coworker carries members, a lab its actor; neither needs stages).
  if (kind === "fan-out" && !stages) {
    return {
      ok: false,
      why: `no [[stage]] entries in ${join(dir, "workflow.toml")} — a fan-out program declares its workers as stages (docs/STAGES.md, ADR 0014)`,
      code: 1,
    }
  }
  // #205 — guarantee a deliverable on every commission: the door
  // refuses a program that declares none. The declaration is
  // contract.toml's [[contract.deliverables]] (the same file the
  // program's audit renders its checks from — one source); existence
  // stays the program's own verdict hook's to judge, because unit ids
  // and artifacts only exist mid-run. Sits AFTER the grammar and
  // brief-path screens (the more specific refusal speaks first).
  const deliverables = deliverablesOf(dir)
  if (deliverables === null || deliverables.length === 0) {
    return {
      ok: false,
      why: "no deliverable forced in contract.toml — every commission guarantees a human-readable deliverable (#205). Declare [[contract.deliverables]] (see test/e2e/whl-interview/contract.toml).",
      code: 1,
    }
  }
  // the check stops at the last program screen: passed = would book,
  // and nothing was minted proving it
  if (opts.check) return { ok: true, kind, warnings: [] }
  return book(dir, kind, task, slots, (store) => stageRun(dir, store))
}
