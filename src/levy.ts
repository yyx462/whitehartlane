import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { prepareRun } from "./run.ts"
import { abortJob, saveJob } from "./store.ts"

export type LevyOutcome =
  | { ok: true; jid: string; jobDir: string; warnings: string[] }
  | { ok: false; why: string }

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
  const orchestrator = process.env.AGENTIC_OS_ORCHESTRATOR ?? join(input.orchestratorRoot, "orchestrator")
  if (!existsSync(orchestrator)) {
    abortJob(ready.job, `no orchestrator at ${orchestrator}`, 0, "rail")
    return { ok: false, why: `no orchestrator at ${orchestrator}` }
  }
  const logFd = openSync(ready.log, "a")
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", orchestrator, ready.job.dir],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        AGENTIC_OS_SID: ready.job.sid,
        AGENTIC_OS_JID: ready.job.id,
      },
    },
  )
  child.unref()
  ready.job.pid = child.pid
  saveJob(ready.job)
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
