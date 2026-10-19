import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { expandHome, scopeCovers, scopeFromDir } from "./permission.ts"
import { loadSpurFile, type Spur } from "./spur.ts"
import { HookError, gradeSmoke, loadManifest, probeHooks } from "./hooks.ts"
import { workflowKind, type WorkflowKind } from "./workflow-kind.ts"
import { admitAnotherJob, admitFanOut } from "./policy.ts"
import { contentHashOf, ensureProject, labelsFor, registerSpur, spurIdOf, type SpurIdentity } from "./project.ts"
import {
  appendEvent,
  createJob,
  eventsPath,
  findOrOpenSession,
  listJobs,
  type JobRecord,
  type SpawnerPointer,
} from "./store.ts"

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
  let raw = readFileSync(join(source, "workflow.toml"), "utf8")
  const cmds = [
    manifest.hooks.units,
    manifest.hooks.grade,
    manifest.hooks.counts,
    manifest.detectors?.signal,
    manifest.detectors?.end,
    ...Object.values(manifest.gates ?? {}),
  ]
  for (const cmd of cmds) {
    if (cmd) raw = raw.replaceAll(cmd, absolutize(cmd, source))
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
  for (const name of ["actor.md", "task.txt", "spur.mjs", "dag.mjs", "roots.txt", "project.json"]) {
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
}

export type SpurFile = { path: string; legacy: boolean }

// The run door resolves the program file (ADR 0009): spur.mjs is the
// spelling; a legacy dag.mjs still admits the program (the `legacy`
// flag turns into a loud warning at the door); a folder holding BOTH
// spellings is refused — an ambiguous program books nothing.
export function spurFileOf(input: string): SpurFile | null {
  const resolved = resolve(input)
  if (!existsSync(resolved)) return null
  if (statSync(resolved).isFile()) {
    const base = basename(resolved)
    if (base === "spur.mjs") return { path: resolved, legacy: false }
    if (base === "dag.mjs") {
      if (existsSync(join(dirname(resolved), "spur.mjs"))) {
        throw new Error("ambiguous program: both spur.mjs and dag.mjs")
      }
      return { path: resolved, legacy: true }
    }
    return null
  }
  const spur = join(resolved, "spur.mjs")
  const legacy = join(resolved, "dag.mjs")
  if (existsSync(spur) && existsSync(legacy)) {
    throw new Error("ambiguous program: both spur.mjs and dag.mjs")
  }
  if (existsSync(spur)) return { path: spur, legacy: false }
  if (existsSync(legacy)) return { path: legacy, legacy: true }
  return null
}

function defaultManifest(spur: Spur): string {
  const name = spur.name.replaceAll('"', "")
  return [
    "# written by whitehartlane: a spur-only program names steps; the OS supplies the hooks",
    "[workflow]",
    `name = "${name}"`,
    'worker_kind = "opencode"',
    "",
    "# hooks are optional (issue #120): omitted counts uses the built-in",
    '# counter — add counts = "default" to say it out loud. Never write',
    '# counts = "true": it prints nothing and aborts the run at report',
    "# time (j-64e035). A units hook is only needed by fan-out programs",
    "# without steps.",
    "",
  ].join("\n")
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
  const { session } = findOrOpenSession({
    cwd: dir,
    host: { tool: "whitehartlane", session_id: dir },
  })
  const running = listJobs(session.id).filter((job) => job.state === "running").length
  const another = admitAnotherJob(running)
  if (!another.admit) {
    appendEvent(session.id, { actor: "cli", kind: "reject", why: another.why, workflow: kind })
    return { ok: false, why: another.why ?? "a job is already running", code: 1 }
  }
  const warnings: string[] = [...preWarnings]
  // spur identity: project pid (minted once into project.json), spur_id
  // (explicit, else the name, else a hashed id + a loud warning), the
  // source content hash as the version, branch/worktree as labels.
  // Paths are never identity; worktrees copy project.json and combine.
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
        try {
          return readFileSync(join(dir, "spur.mjs"), "utf8")
        } catch {
          try {
            return readFileSync(join(dir, "dag.mjs"), "utf8")
          } catch {
            return task
          }
        }
      }
    })(),
  })
  if (spurId.derived) {
    warnings.push(`no spur_id (and no name) in ${dir} — derived ${spurId.spurId} from content; define workflow.spur_id to group runs`)
  }
  const version = contentHashOf(dir)
  const dup = registerSpur(proj.pid, spurId.spurId, version, dir)
  if (dup) warnings.push(dup)
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
      const refusals = probeHooks(dir, manifest, kind)
      if (refusals.length > 0) {
        appendEvent(session.id, { actor: "cli", kind: "reject", why: `hook probe: ${refusals[0]}`, workflow: kind })
        return { ok: false, why: `hook probe refused: ${refusals.join("; ")}`, code: 1 }
      }
    } catch (err) {
      // prepareRun/prepareLabRun already surface manifest faults; one
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
  })
  stage(job.dir)
  appendEvent(session.id, { actor: "cli", kind: "admit", jid: job.id, workflow: kind })
  return { ok: true, job, log: join(job.dir, "orchestrator.log"), trace: eventsPath(session.id), kind, warnings }
}

function stageSpur(spur: Spur, dir: string, toml: boolean): (store: string) => void {
  return (store) => {
    if (toml) {
      stageRun(dir, store)
      return
    }
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, "workflow.toml"), defaultManifest(spur))
    copyBeside(dir, store)
  }
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
function uncoveredBriefPaths(source: string): string[] {
  const scope = scopeFromDir(source)
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

// the lab path: a program file was found, the spur graph drives the run
function prepareLabRun(spurFile: SpurFile): RunReady | RunRefused {
  const warnings: string[] = []
  // ADR 0009: a legacy dag.mjs still admits — loudly
  if (spurFile.legacy) warnings.push("legacy dag.mjs — rename to spur.mjs")
  const dir = dirname(spurFile.path)
  let spur: Spur
  try {
    spur = loadSpurFile(spurFile.path, (message) => warnings.push(message))
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    return { ok: false, why, code: 1 }
  }
  let slots = 2
  let task = spur.name
  const toml = existsSync(join(dir, "workflow.toml"))
  let gates: Record<string, string> | undefined
  if (toml) {
    try {
      const manifest = loadManifest(dir)
      slots = manifest.workflow.slots ?? 2
      task = manifest.workflow.name
      gates = manifest.gates
    } catch (err) {
      const why = err instanceof HookError ? err.message : err instanceof Error ? err.message : String(err)
      return { ok: false, why, code: 1 }
    }
  }
  for (const step of spur.steps.filter((s) => s.does === "gate")) {
    if (!gates?.[step.id]) {
      return {
        ok: false,
        why: `gate step ${step.id} needs a [gates] ${step.id} detector command in workflow.toml`,
        code: 1,
      }
    }
  }
  return book(dir, "lab", task, slots, stageSpur(spur, dir, toml), warnings)
}

export function prepareRun(folder: string): RunReady | RunRefused {
  let spurFile: SpurFile | null = null
  try {
    spurFile = spurFileOf(folder)
  } catch (err) {
    return { ok: false, why: err instanceof Error ? err.message : String(err), code: 1 }
  }
  if (spurFile) return prepareLabRun(spurFile)
  const dir = resolve(folder)
  if (!existsSync(join(dir, "workflow.toml"))) {
    return { ok: false, why: `no workflow.toml in ${dir}`, code: 1 }
  }
  let slots = 2
  let task = basename(dir)
  let kind: WorkflowKind = "fan-out"
  try {
    kind = workflowKind(readFileSync(join(dir, "workflow.toml"), "utf8"))
    const manifest = loadManifest(dir)
    slots = manifest.workflow.slots ?? 2
    task = manifest.workflow.name
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
  return book(dir, kind, task, slots, (store) => stageRun(dir, store))
}
