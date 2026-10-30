import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum40-"))

import { prepareRun } from "../../src/doors/run.ts"
import {
  acquireLease,
  continueJob,
  findSessionByHost,
  loadJob,
  pauseJob,
  saveJob,
} from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place — "who leads this job?") / INV-4 (the
// record must keep telling the truth about who leads).
//
// This diff rewrote continueJob around the single-act law (gate-r11
// principles-33): "the caller holds a boot-time snapshot across a LONG
// ceremony (the drain rebirth spans minutes; continue's straggler
// retire 30s/pane) — a flip landing inside that window must survive
// this write … The FRESH record decides: a receipt that differs from
// the caller's snapshot STANDS". The law enumerates receipt-flips
// (abort/pause/orphan/retired — the superseded arm) but reads a fresh
// state of "running" as "nothing happened, proceed" — and proceeds by
// CLOBBERING: continues +1 and the caller's child pid stamped over
// whatever revival landed in the window. A twin `whl continue` on the
// same parked job is exactly such a landing, and it is the lease's own
// named threat (j-93d652 gap #2, "double-continue split brain"): the
// twin's ceremony completes first (running + its pid + the lease), our
// ceremony — already past its liveLeaseHolder check, sitting in the
// retire loop — stamps ITS child over the leader's pid. Our child then
// dies at the twin's lease the moment it boots (the lease stays the
// authoritative backstop), and the record is left pointing at the
// lease's LOSER: the winner drives live and unrecorded, bookingStale
// reads the dead pid, and this diff's new booking probe (momentum-41)
// orphans the live run on the next re-levy.
//
// One decision — "who leads?" — answered twice, oppositely: the lease
// crowns the twin's runner; continueJob's tail crowns ours. The
// single-act law this diff wrote must treat a divergent REVIVAL the
// way it treats a divergent receipt: the fresh record stands.
//
// Deterministic (scripted interleave, no timing — the repo's own
// device, momentum-12-r24): the leader is a real live process; our
// child is real too and is killed after the clobber, which is the
// lease's own verdict on it. On BASE continueJob clobbers the same way
// (no fresh read at all): the repro fails there too — the law is new,
// its twin is old (the r25 principles-22 posture: "the veto does not
// exist anywhere on BASE … the law is new, its twin is old").
test("continueJob must not clobber a twin revival that landed during this caller's ceremony", async () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-m40-prog-"))
  cpSync(FIXTURE, prog, { recursive: true })
  const leader = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" })
  let ourChild: import("node:child_process").ChildProcess | null = null
  try {
    // booking 1, then the park our two verbs both revive from: the
    // previous generation's runner is dead on the record
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    if (!first.ok) return
    const jobA = (first as { job: { id: string; sid: string } }).job
    const session = findSessionByHost("whitehartlane", prog)
    assert.ok(session, "sanity: the lineage session exists")
    const parked = loadJob(session!.id, jobA.id)!
    parked.pid = 999_999_999 // long gone — a parked generation's dead pid
    saveJob(parked)
    pauseJob(loadJob(session!.id, jobA.id)!, "drain", 0)

    // OUR verb loads its snapshot at verb start (paused) and enters the
    // ceremony: liveLeaseHolder passes (no live holder yet), the
    // successor veto passes (nothing running), the straggler retire runs.
    const snapshot = loadJob(session!.id, jobA.id)!
    assert.equal(snapshot.state, "paused", "premise: the caller's snapshot is the parked record")

    // ── THE TWIN REVIVAL LANDS mid-ceremony (scripted): its full
    // ceremony effect on the store — record running with ITS child,
    // continues bumped, and its runner's boot stamping the lease.
    const twin = loadJob(session!.id, jobA.id)!
    twin.state = "running"
    twin.pid = leader.pid!
    twin.continues = (twin.continues ?? 0) + 1
    saveJob(twin)
    acquireLease(loadJob(session!.id, jobA.id)!, `orchestrator pid=${leader.pid}`)

    // ── OUR ceremony's tail: spawnRunner returned OUR child (alive at
    // this instant) and continueJob writes it. The lease will kill our
    // child at its boot — killed here, which is that verdict.
    ourChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" })
    continueJob(snapshot, ourChild.pid!)
    ourChild.kill("SIGKILL")
    await new Promise<void>((resolve) => ourChild!.once("exit", () => resolve()))

    // THE LAW: the fresh record told this caller someone else revived
    // the job (state running, continues already bumped, a LIVE lease);
    // the revival divergence must STAND, like a receipt does — the live
    // leader keeps the record.
    const after = loadJob(session!.id, jobA.id)
    assert.equal(
      after?.pid,
      leader.pid,
      `INV-3/INV-4: "who leads this job?" is answered twice by this diff's own rewrite — the lease crowns the ` +
        `twin revival's runner (a live holder on the same record), and continueJob's tail crowns the caller's ` +
        `child: the fresh record read state "running" with continues already bumped by the twin, and the ` +
        `single-act law read that divergence as "nothing happened" and CLOBBERED the leader's pid with ours ` +
        `(record pid now ${after?.pid}, our child dead at the leader's lease, the leader driving live and ` +
        `unrecorded). The next booking probe reads that dead pid and orphans a live run (momentum-41). The ` +
        `law's own words — "a receipt that differs from the caller's snapshot STANDS" — must cover the revival ` +
        `divergence too: a fresh record this caller did not flip to running is another writer's revival, and ` +
        `continueJob must stand down from its pid the way it stands down from a superseding receipt.`,
    )
    assert.equal(
      after?.state,
      "running",
      "the record stays running either way — the lie is WHO it names, not whether it runs",
    )
  } finally {
    try {
      if (leader.pid) process.kill(leader.pid, "SIGKILL")
    } catch {
      /* already gone */
    }
    try {
      if (ourChild?.pid && ourChild.exitCode === null) ourChild.kill("SIGKILL")
    } catch {
      /* already gone */
    }
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
