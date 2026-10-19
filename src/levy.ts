import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { prepareRun } from "./run.ts"
import { abortJob, continueJob, killPane, saveJob, type JobRecord } from "./store.ts"

export type LevyOutcome =
  | { ok: true; jid: string; jobDir: string; warnings: string[] }
  | { ok: false; why: string }

// ── the run envelope (OPTIMUM §2 slice 2) ───────────────────────────
//
// One runner door means ONE way to start it. Every verb that hands a
// Job to a runner process — the run door, continue, refresh, and the
// levy's own children — goes through these. Before, each call site
// hand-rolled the spawn (and drift showed: `run` and the levy honored
// AGENTIC_OS_ORCHESTRATOR while `continue`/`refresh` silently ignored
// it, and only some sites checked the door exists).

// The runner door path: env override (tests, pinned doors), else the
// caller's own root (dev: bin/, npm bundle: dist/).
export function runnerDoor(orchestratorRoot: string): string {
  return process.env.AGENTIC_OS_ORCHESTRATOR ?? join(orchestratorRoot, "orchestrator")
}

export type SpawnOutcome = { ok: true; pid: number } | { ok: false; why: string }

// Hand a Job to its runner process: detached, logged to the Job's
// orchestrator.log, booked with SID/JID env, pid saved on the record.
// Refuses (rather than spawning nothing silently) when the door is
// missing — the caller decides how to book the refusal.
export function spawnRunner(
  job: JobRecord,
  orchestratorRoot: string,
  opts: { extraEnv?: Record<string, string> } = {},
): SpawnOutcome {
  const door = runnerDoor(orchestratorRoot)
  if (!existsSync(door)) return { ok: false, why: `no orchestrator at ${door}` }
  const logFd = openSync(join(job.dir, "orchestrator.log"), "a")
  const child = spawn(process.execPath, ["--experimental-strip-types", door, job.dir], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      AGENTIC_OS_SID: job.sid,
      AGENTIC_OS_JID: job.id,
      ...(opts.extraEnv ?? {}),
    },
  })
  child.unref()
  job.pid = child.pid
  saveJob(job)
  return { ok: true, pid: child.pid }
}

// The rebirth ceremony (ADR 5), one spelling for continue and refresh:
// retire the previous generation's stragglers (a live pane from the
// parked generation would double-write a unit dir), then hand the Job
// to a fresh runner — which books the continue on the record.
export function rebirthRunner(job: JobRecord, orchestratorRoot: string): SpawnOutcome {
  for (const pane of job.panes.filter((p) => p.died === undefined)) {
    try {
      execFileSync("shep", ["retire", pane.label], { timeout: 30_000 })
    } catch {}
    killPane(job, pane.label)
  }
  const out = spawnRunner(job, orchestratorRoot)
  if (out.ok) continueJob(job, out.pid)
  return out
}

// The drain ceiling (ADR 5): `pause --wait`/`refresh` write a one-shot
// deadline into the Job dir — read and cleared at the first drain.
// Anything missing or unparsable falls back to now + the configured
// ceiling. Lives with the envelope: every engine's drain asks this.
export function drainDeadline(taskDir: string, nowMs: number, ceilingMs: number): number {
  const path = join(taskDir, "drain.deadline")
  try {
    const at = Date.parse(readFileSync(path, "utf8").trim())
    rmSync(path, { force: true })
    if (Number.isFinite(at)) return at
  } catch {
    // no override file — the configured ceiling applies
  }
  return nowMs + ceilingMs
}

// ADR 0007 stage 3 — the rail as levy. A wake step's folder is a whole
// program: this stages it through the same admission the door uses
// (agentic-os run), books the RAIL as spawner (tool "rail": a process,
// not a conversation — no pane holds it, no doorbell serves it), and
// spawns the child orchestrator detached. The durable wake.json on the
// child's job dir is the receipt the parent polls; the child survives
// the parent's death (continue re-nurses from the booking on disk).
export function levyChildProgram(input: {
  folder: string
  parentSid: string
  // dir holding the orchestrator bins (import.meta.dirname of the parent)
  orchestratorRoot: string
  now?: () => Date
}): LevyOutcome {
  const ready = prepareRun(input.folder)
  if (!ready.ok) return { ok: false, why: ready.why }
  ready.job.spawner = {
    tool: "rail",
    session_id: input.parentSid,
    since: (input.now ?? (() => new Date()))().toISOString(),
  }
  const spawned = spawnRunner(ready.job, input.orchestratorRoot)
  if (!spawned.ok) {
    abortJob(ready.job, spawned.why, 0, "rail")
    return { ok: false, why: spawned.why }
  }
  return { ok: true, jid: ready.job.id, jobDir: ready.job.dir, warnings: ready.warnings }
}

export type WakeBooking = {
  jid: string
  jobDir: string
  folder: string
  leviedAt: string
}

// The levy is durable on the parent's task dir: a paused or crashed
// parent re-nurses from the booking instead of levying a second child.
export function wakeBookingPath(taskDir: string, stepId: string): string {
  return join(taskDir, "wakes", `${stepId}.json`)
}

export function readWakeBooking(taskDir: string, stepId: string): WakeBooking | null {
  try {
    return JSON.parse(readFileSync(wakeBookingPath(taskDir, stepId), "utf8")) as WakeBooking
  } catch {
    return null
  }
}

export function writeWakeBooking(taskDir: string, stepId: string, booking: WakeBooking): void {
  mkdirSync(join(taskDir, "wakes"), { recursive: true })
  writeFileSync(wakeBookingPath(taskDir, stepId), JSON.stringify(booking, null, 2) + "\n")
}

export type ChildWake = { outcome: string; report?: string; jid?: string; task?: string }

// The receipt the parent polls: wake.json on the child job dir, written
// by the child's one and only end-of-job wake (finish, abort, orphan —
// every terminal state books it; pause does not, by design).
export function readChildWake(jobDir: string): ChildWake | null {
  try {
    return JSON.parse(readFileSync(join(jobDir, "wake.json"), "utf8")) as ChildWake
  } catch {
    return null
  }
}
