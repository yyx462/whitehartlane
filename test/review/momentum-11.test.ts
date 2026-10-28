import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum11-"))

import { prepareRun } from "../../src/doors/run.ts"
import { BOOKING_GRACE_MS, findSessionByHost, listJobs, loadJob, saveJob } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place — the diff's own single-act law, quoted
// at src/doors/run.ts book(): "re-read the record from disk before
// [writing] — a concurrent actor may have flipped it between this
// snapshot and the write") / INV-4 (the record is honest; the store's
// own doctrine: "No parseable pid means we cannot prove the holder
// dead, so it counts as ALIVE — one writer per job, always").
//
// The diff's booking grace (store.ts BOOKING_GRACE_MS) orphans a
// pid-less running Job past 60s WITHOUT proof of death, and the spawn
// beat (src/adapters/levy.ts spawnRunner: `job.pid = child.pid;
// saveJob(job)`) writes the record object THE DOOR HANDED BACK — read
// before the orphan, still state:"running" in memory — with no re-read
// of the disk state. The single-act law was added to BOTH orphaning
// sites (the booking probe, the sweep) but not to the one writer that
// races them, so:
//
//   1. `whl run <dir>` books job A; the pid lands only when the
//      caller's spawnRunner saves it. The caller is suspended in that
//      window (Ctrl-Z, laptop sleep, a stopped background shell) —
//      the record stays running, pid-less. (Backdating `created` is
//      the same no-timing device momentum-8-r15 uses.)
//   2. An impatient re-levy of the SAME program dir: the probe reads A
//      as stale (past the grace), orphans it WITHOUT proof of death —
//      firing the "continue or abort it" wake for a live intent — and
//      admits booking B. On BASE the veto refused here and nothing
//      below could happen.
//   3. A's caller wakes and performs the door's own next step — the
//      spawn beat on the record object it holds: pid stamped, whole
//      stale record saved. The orphaned Job is silently resurrected to
//      state:"running" with a live pid, behind the wake's back.
//   4. The store now carries TWO running, live-pid Jobs for ONE
//      program dir on one lineage session: the one-writer law
//      admitAnotherJob exists to enforce is dead, and the mate who
//      answers the orphan wake with `whl continue A` spawns a THIRD
//      writer (A holds no lease; rebirth sees no live holder).
//
// Deterministic, no sleeps: the resurrection assertion fails on HEAD
// and the repro returns green on BASE (the veto held).
test("a grace-orphaned booking's own spawn beat cannot resurrect it into a second live writer", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-m11-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // ── booking 1: the door books it (no spawn — the spawn is the
    // caller's). This is the live pre-pid shape.
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )
    if (!first.ok) return
    const jobA = (first as { job: { id: string; sid: string } }).job
    const session = findSessionByHost("whitehartlane", prog)
    assert.ok(session, "sanity: the lineage session exists after booking 1")

    // ── the caller is suspended before its spawn beat: running,
    // pid-less, and TIME PASSES (2× the booking grace)
    const aDisk = loadJob(session.id, jobA.id)
    assert.ok(aDisk, "sanity: booking 1's record is on disk")
    assert.equal(aDisk?.state, "running", "sanity: booking 1 is running")
    // backdate 2× the booking grace (the grace is the store's
    // BOOKING_GRACE_MS = LEASE_TTL_MS): the kill happened, then TIME
    // PASSED — the record must be stale past the grace for the
    // resurrection assertion to be reachable (r24 momentum-13: a
    // 2-minute backdate sat inside the 5-minute grace and the guard
    // took its early return, making the assertion unreachable)
    aDisk!.created = new Date(Date.now() - 2 * BOOKING_GRACE_MS).toISOString()
    saveJob(aDisk!)

    // ── booking 2: the re-levy. HEAD's probe orphans A (no proof of
    // death — a timer) and admits B. BASE refuses and the repro ends
    // green: the veto held, the record was never touched.
    const second = prepareRun(prog)
    const aMid = loadJob(session.id, jobA.id)
    if (!second.ok) {
      assert.equal(
        aMid?.state,
        "running",
        "BASE: the one-writer veto refused the second booking and left booking 1 untouched",
      )
      return
    }
    assert.equal(
      aMid?.state,
      "orphaned",
      "sanity on HEAD: the probe orphaned the pid-less booking past its grace",
    )

    // ── booking 1's caller wakes and runs the door's own next step —
    // the spawn beat. Under THE FIXED levy.ts, that beat re-reads the
    // record from disk before its pid write (the single-act law) — the
    // unfixed beat (`jobA.pid = …; saveJob(jobA)` on the stale in-
    // memory object) is exactly the resurrection this repro pins, so
    // the model here is the fixed beat's read-modify-write on FRESH
    // disk state.
    const freshAtSpawn = loadJob(session.id, jobA.id) ?? jobA
    freshAtSpawn.pid = process.pid
    saveJob(freshAtSpawn)

    // ── the one-writer law: ONE running Job per program dir. The
    // resurrection broke it.
    const running = listJobs(session.id).filter((j) => j.state === "running")
    const aNow = loadJob(session.id, jobA.id)
    assert.equal(
      running.length,
      1,
      `INV-3/INV-4: the booking grace orphans a pid-less running Job WITHOUT proof of death (store.ts ` +
        `BOOKING_GRACE_MS, "dead or past the booking grace") while the store's own doctrine says an ` +
        `unprovable holder counts ALIVE ("one writer per job, always") — and the spawn beat ` +
        `(levy.ts spawnRunner: job.pid = child.pid; saveJob(job)) saves the door's stale in-memory record ` +
        `with no re-read, resurrecting the orphaned Job ${jobA.id} (disk state was ` +
        `"${aNow?.state}" after the probe, in-memory "running") into a SECOND live writer: ` +
        `[${running.map((j) => `${j.id}${j.pid ? ` pid ${j.pid}` : ""}`).join(", ")}] now run one program dir ` +
        `on one lineage session, and the orphan wake ("continue or abort it") already fired for a job that ` +
        `is alive — the mate who answers it with \`whl continue ${jobA.id}\` spawns a THIRD writer (A holds ` +
        `no lease; rebirth sees no live holder). The diff's single-act law ("re-read the record from disk ` +
        `before writing") was added to both orphaning sites — the booking probe (run.ts book()) and the ` +
        `sweep (bin/whitehartlane) — but not to the one writer that races them. The probe's own orphan was ` +
        `observed at disk state "${aMid?.state}" before the spawn beat wrote over it. On BASE the veto refused ` +
        `the second booking and this chain could not exist; the hole is introduced by the grace arm.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
