import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { HookError, loadManifest } from "./hooks.ts"
import { workflowKind } from "./workflow-kind.ts"
import { admitAnotherJob, admitFanOut } from "./policy.ts"
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
  kind: "fan-out" | "lab"
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
  for (const cmd of [manifest.hooks.units, manifest.hooks.grade, manifest.hooks.counts]) {
    raw = raw.replaceAll(cmd, absolutize(cmd, source))
  }
  writeFileSync(join(store, "workflow.toml"), raw)
  const actorFile = join(source, "actor.md")
  if (existsSync(actorFile)) writeFileSync(join(store, "actor.md"), readFileSync(actorFile))
  const taskFile = join(source, "task.txt")
  if (existsSync(taskFile)) writeFileSync(join(store, "task.txt"), readFileSync(taskFile))
}

export function prepareRun(folder: string): RunReady | RunRefused {
  const dir = resolve(folder)
  if (!existsSync(join(dir, "workflow.toml"))) {
    return { ok: false, why: `no workflow.toml in ${dir}`, code: 1 }
  }
  let slots = 2
  let task = basename(dir)
  let kind: "fan-out" | "lab" = "fan-out"
  try {
    kind = workflowKind(readFileSync(join(dir, "workflow.toml"), "utf8"))
    const manifest = loadManifest(dir)
    slots = manifest.workflow.slots ?? 2
    task = manifest.workflow.name
  } catch (err) {
    const why = err instanceof HookError ? err.message : err instanceof Error ? err.message : String(err)
    return { ok: false, why, code: 1 }
  }
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
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: kind,
    task,
    runDir: true,
  })
  stageRun(dir, job.dir)
  appendEvent(session.id, { actor: "cli", kind: "admit", jid: job.id, workflow: kind })
  return { ok: true, job, log: join(job.dir, "orchestrator.log"), trace: eventsPath(session.id), kind }
}
