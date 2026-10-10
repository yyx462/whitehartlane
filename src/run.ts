import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { loadDagFile, type Dag } from "./dag.ts"
import { HookError, loadManifest } from "./hooks.ts"
import { workflowKind, type WorkflowKind } from "./workflow-kind.ts"
import { admitAnotherJob, admitFanOut } from "./policy.ts"
import { contentHashOf, dagIdOf, ensureProject, labelsFor, registerDag } from "./project.ts"
import {
  appendEvent,
  createJob,
  eventsPath,
  findOrOpenSession,
  listJobs,
  type JobRecord,
} from "./store.ts"

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
  for (const name of ["actor.md", "task.txt", "dag.mjs", "roots.txt", "project.json"]) {
    const file = join(source, name)
    if (existsSync(file)) writeFileSync(join(store, name), readFileSync(file))
  }
  // a program may carry a data/ folder — the files the briefs and hooks
  // read; it is staged beside the dag so the run is self-contained
  const data = join(source, "data")
  if (existsSync(data)) cpSync(data, join(store, "data"), { recursive: true })
  // a coworker program carries member briefs in members/<name>.md
  const members = join(source, "members")
  if (existsSync(members)) cpSync(members, join(store, "members"), { recursive: true })
}

export function dagFileOf(input: string): string | null {
  const resolved = resolve(input)
  if (!existsSync(resolved)) return null
  if (statSync(resolved).isFile()) return basename(resolved) === "dag.mjs" ? resolved : null
  const nested = join(resolved, "dag.mjs")
  return existsSync(nested) ? nested : null
}

function defaultManifest(dag: Dag): string {
  const name = dag.name.replaceAll('"', "")
  const counts = "node -p \"(r=>JSON.stringify({units:r.length,passed:r.filter(x=>x.pass).length,failed:r.filter(x=>!x.pass).length}))(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))\""
  return [
    "# written by agentic-os: a dag-only program names steps; the OS supplies the hooks",
    "[workflow]",
    `name = "${name}"`,
    'worker_kind = "opencode"',
    "",
    "[hooks]",
    'units = "true"',
    'grade = "true"',
    `counts = "${counts}"`,
    "",
  ].join("\n")
}

function book(
  dir: string,
  kind: WorkflowKind,
  task: string,
  slots: number,
  stage: (store: string) => void,
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
    host: { tool: "agentic-os", session_id: dir },
  })
  const running = listJobs(session.id).filter((job) => job.state === "running").length
  const another = admitAnotherJob(running)
  if (!another.admit) {
    appendEvent(session.id, { actor: "cli", kind: "reject", why: another.why, workflow: kind })
    return { ok: false, why: another.why ?? "a job is already running", code: 1 }
  }
  const warnings: string[] = []
  // dag identity: project pid (minted once into project.json), dag_id
  // (explicit, else the name, else a hashed id + a loud warning), the
  // source content hash as the version, branch/worktree as labels.
  // Paths are never identity; worktrees copy project.json and combine.
  const proj = ensureProject(dir)
  if (proj.minted) warnings.push(`no project.json in ${dir} — minted ${proj.pid} and wrote it there`)
  const dagId = dagIdOf({
    dagId: (() => {
      try {
        return loadManifest(dir).workflow.dag_id
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
          return readFileSync(join(dir, "dag.mjs"), "utf8")
        } catch {
          return task
        }
      }
    })(),
  })
  if (dagId.derived) {
    warnings.push(`no dag_id (and no name) in ${dir} — derived ${dagId.dagId} from content; define workflow.dag_id to group runs`)
  }
  const version = contentHashOf(dir)
  const dup = registerDag(proj.pid, dagId.dagId, version, dir)
  if (dup) warnings.push(dup)
  const dag = {
    project: proj.pid,
    project_name: proj.name,
    dag_id: dagId.dagId,
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
    dag,
  })
  stage(job.dir)
  appendEvent(session.id, { actor: "cli", kind: "admit", jid: job.id, workflow: kind })
  return { ok: true, job, log: join(job.dir, "orchestrator.log"), trace: eventsPath(session.id), kind, warnings }
}

function stageDag(dag: Dag, dir: string, toml: boolean): (store: string) => void {
  return (store) => {
    if (toml) {
      stageRun(dir, store)
      return
    }
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, "workflow.toml"), defaultManifest(dag))
    copyBeside(dir, store)
  }
}

// Issue #51: a program whose briefs name paths no root covers is a
// manifest-level mismatch — better refused at the door than discovered
// by the worker dying mid-run (j-a532f9: a missing roots.txt turned
// every target-tree touch into a jev gray-zone ask). Scans the static
// text the program ships (task.txt, actor.md, members/*.md) for
// existing absolute paths; any not under the program dir, a roots.txt
// entry, or temp scratch is named in the refusal.
function uncoveredBriefPaths(source: string): string[] {
  const roots = [source]
  const rootsTxt = join(source, "roots.txt")
  if (existsSync(rootsTxt)) {
    for (const line of readFileSync(rootsTxt, "utf8").split("\n")) {
      const t = line.trim().replace(/^~(?=\/)/, homedir())
      if (t) roots.push(t)
    }
  }
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
  const tempRoots = ["/tmp", "/private/tmp", "/var/folders", tmpdir()]
  const uncovered = new Set<string>()
  for (const text of texts) {
    for (const raw of text.match(/~?\/[A-Za-z0-9._~+-]+(?:\/[A-Za-z0-9._~+-]+)+/g) ?? []) {
      const p = raw.replace(/^~(?=\/)/, homedir())
      if (roots.some((r) => p === r || p.startsWith(`${r}/`))) continue
      if (tempRoots.some((t) => p === t || p.startsWith(`${t}/`))) continue
      if (!existsSync(p)) continue // to-be-created scratch is not a boundary
      uncovered.add(p)
    }
  }
  return [...uncovered]
}

export function prepareRun(folder: string): RunReady | RunRefused {
  const dagFile = dagFileOf(folder)
  if (dagFile) {
    const dir = dirname(dagFile)
    let dag: Dag
    try {
      dag = loadDagFile(dagFile)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return { ok: false, why, code: 1 }
    }
    let slots = 2
    let task = dag.name
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
    for (const step of dag.steps.filter((s) => s.does === "gate")) {
      if (!gates?.[step.id]) {
        return {
          ok: false,
          why: `gate step ${step.id} needs a [gates] ${step.id} detector command in workflow.toml`,
          code: 1,
        }
      }
    }
    return book(dir, "lab", task, slots, stageDag(dag, dir, toml))
  }
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
