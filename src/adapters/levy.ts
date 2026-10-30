import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { abortJob, bookingStale, claimRevivalFlip, killPane, listJobs, liveLeaseHolder, loadJob, saveJob, type JobRecord } from "./store.ts"

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
  // THE CLAIM PRECEDES THE SPAWN (gate-r22 momentum-50): the child's
  // boot enforces the stand-down law on "not running" (rail.ts), so a
  // child spawned against a record still reading PAUSED kills its own
  // revival whenever its boot read lands before the parent's flip —
  // and the parent then stamped a running receipt naming the dead
  // child. Claim first (write-site guards included): the child always
  // boots into a record that says running. A fresh booking (record
  // born running, pid-less) claims nothing — the no-op branch.
  // the one-writer session read AT THE WRITE (gate-r23 momentum-60):
  // the ceremony door checked at entry, then spent the retire window
  // (30s per un-died pane, errors swallowed) — a booking admitted
  // inside it rode past the door's one-shot veto into two live
  // writers on one program dir. The commit point re-reads the
  // session; a fresh booking (the only running Job on its session)
  // sails through.
  // THE VETO PRECEDES THE CLAIM (gate-r25 momentum-70/questions-16):
  // claim-first left a veto REFUSAL holding a lying record — flipped
  // to running, the pause receipt deleted, continues bumped — and the
  // refusal's own prescribed recovery (`whl continue`) dead-ends at
  // the continue verb's parked-state gate. The veto reads; only a
  // passing veto claims. A refusal mutates nothing.
  const veto = successorVetoWhy(job)
  if (veto) return { ok: false, why: veto }
  // THE LOG SEAT PRECEDES EVERY MUTATION (gate-r33b tests-9001): the
  // open was unguarded AND after the claim — a job whose run dir is
  // gone made openSync throw ENOENT with the record already flipped
  // to running and its pause receipt deleted: 'a refusal mutates
  // nothing' one step later than the arm above. Open (guarded) after
  // the read-only veto, before the mutating claim; only a spawnable
  // job claims.
  let logFd: number
  try {
    logFd = openSync(join(job.dir, "orchestrator.log"), "a")
  } catch (err) {
    return { ok: false, why: `cannot open ${join(job.dir, "orchestrator.log")} (${err instanceof Error ? err.message : String(err)}) — the run dir is gone; refusing without mutating the record` }
  }
  const claim = claimRevivalFlip(job)
  if (!claim.ok) return { ok: false, why: claim.why }
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
  // r20 momentum-11: save the FRESH record — the door's in-memory copy
  // may be stale (the booking probe may have orphaned this very Job
  // while this spawn beat was in flight); clobbering it with the stale
  // object resurrects the orphan flip into a second live writer. The
  // pid lands on whatever the disk now holds; an orphaned record keeps
  // its orphan receipt (the runner is live — `whl continue` revives it
  // with the booked pid).
  const fresh = loadJob(job.sid, job.id) ?? job
  fresh.pid = child.pid
  saveJob(fresh)
  return { ok: true, pid: child.pid }
}

// The rebirth ceremony (ADR 5), one spelling for continue and refresh:
// refuse a live holder at the door, then retire the previous
// generation's stragglers (a live pane from the parked generation
// would double-write a unit dir), then hand the Job to a fresh runner —
// which books the continue on the record.
// The rebirth refusal's exit code — ONE decision, one site (gate-r4
// tests-60: the /successor booking/ classifier lived as a regex at
// both bin revival verbs; one decision answered twice drifts). A
// successor conflict is the one-writer veto speaking: exit 2.
export function rebirthExitCode(why: string): number {
  return /successor booking/.test(why) ? 2 : 1
}

// the successor veto (r25 principles-22): a live successor booking on
// this lineage session forbids another live writer on the program
// dir. ONE seat for the question, asked at the ceremony door (fail
// fast, before a pane dies) and again AT THE WRITE (gate-r23
// momentum-60: the retire window — 30s per un-died pane, errors
// swallowed — outlived the door's one-shot check; a booking admitted
// mid-ceremony rode into the two-live-writers split brain the veto's
// own message names).
export function successorVetoWhy(job: JobRecord): string | null {
  const successor = listJobs(job.sid).find(
    (j) => j.id !== job.id && j.state === "running" && !bookingStale(j, Date.now()),
  )
  return successor
    ? `a successor booking (${successor.id}) is live on this program dir — reviving ${job.id} beside it is two live writers; abort the successor first`
    : null
}

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
  // r25 principles-22 — THE successor screen, seated at the SHARED
  // ceremony both revival verbs land on (refresh's drain-rebirth,
  // continue's rebirth): a live successor booking on this lineage
  // session vetoes the rebirth — two live writers on one program dir
  // is the split brain the booking probe's veto exists to prevent.
  // One seat, not one per caller — and asked AGAIN at the write
  // (spawnRunner, beside the claim): this entry check only fails
  // fast; it cannot promise the window behind it.
  const veto = successorVetoWhy(job)
  if (veto) {
    return { ok: false, why: veto }
  }
  for (const pane of job.panes.filter((p) => p.died === undefined)) {
    try {
      execFileSync("shep", ["retire", pane.label], { timeout: 30_000 })
    } catch {}
    killPane(job, pane.label)
  }
  const out = spawnRunner(job, orchestratorRoot)
  // no continueJob tail (gate-r22 momentum-50): the CLAIM now precedes
  // the spawn inside spawnRunner (the child must boot into a running
  // record), and the child stamps its own pid at boot (rail.ts) — a
  // flip+stamp tail over this ceremony's stale snapshot would only
  // trip the twin guard against the claim this ceremony itself wrote
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
