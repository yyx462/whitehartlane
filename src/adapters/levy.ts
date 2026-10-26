import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { abortJob, continueJob, killPane, liveLeaseHolder, saveJob, type JobRecord } from "./store.ts"

export type SpawnOutcome = { ok: true; pid: number } | { ok: false; why: string }

// The runner door path: env override (tests, pinned doors), else the
// caller's own root (dev: bin/, npm bundle: dist/).
export function runnerDoor(orchestratorRoot: string): string {
  return process.env.AGENTIC_OS_ORCHESTRATOR ?? join(orchestratorRoot, "orchestrator")
}

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
// refuse a live holder at the door, then retire the previous
// generation's stragglers (a live pane from the parked generation
// would double-write a unit dir), then hand the Job to a fresh runner —
// which books the continue on the record.
export function rebirthRunner(job: JobRecord, orchestratorRoot: string): SpawnOutcome {
  // The door refuses first (j-93d652 gap #2): retiring panes under a
  // LIVE holder's feet is the damage a double continue does — fail
  // fast, in the foreground, before a single pane dies. The child's
  // acquireLease stays the authoritative backstop (races, direct door
  // invocations).
  const live = liveLeaseHolder(job)
  if (live) {
    return { ok: false, why: `a live orchestrator holds ${job.id} (${live}) — one writer per job; pause it first, or wait` }
  }
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
// The wait-for DAG, built from receipts alone (completion-detection):
// every booking under wakes/ contributes one edge parentUnit → jid.
// A booking without parentUnit (pre-fold) contributes nothing — the
// graph is by birth acyclic (every levy mints a fresh child job), so
// Is this parent still waiting on a LIVE child? Live = the child has
// not yet written its wake.json (the receipt the parent polls); a
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
