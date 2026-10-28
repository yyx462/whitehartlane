import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p13-"))

import { prepareRun } from "../../src/doors/run.ts"
import { acquireLease, findSessionByHost, listJobs, loadJob, saveJob } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one function per decision — the diff's own single-act law) /
// INV-4 (the record is honest). The diff writes the law into THREE of
// the four writers that race the booking probe:
//   - the probe itself (run.ts book()): "THE single-act law … re-read
//     the record from disk before orphaning" (loadJob ?? job);
//   - the sweep (bin/whitehartlane, sweep verb): "single-act: re-read
//     the record" (loadJob ?? job);
//   - the spawn beat (levy.ts:37-46): "save the FRESH record — the
//     door's in-memory copy may be stale … clobbering it with the
//     stale object resurrects the orphan flip into a second live
//     writer" (loadJob ?? job).
// The FOURTH writer — the runner's own boot stamp, rail.ts openLedger
// (load at rail.ts:252, acquireLease at rail.ts:277, then
// `job.pid = process.pid; job.door = …; saveJob(job)` at rail.ts:282-
// 284) — still writes the record object it loaded at boot, with no
// re-read. saveJob (store.ts:432) persists the WHOLE stale object, so
// a flip that lands between the runner's boot load and its write is
// clobbered from the pre-flip snapshot.
//
// The path that breaks: booking 1's caller is suspended before the
// runner boots (Ctrl-Z, laptop sleep, slow intake) — the record sits
// running and pid-less past BOOKING_GRACE_MS. A second `whl run` of
// the same program dir fires the probe: it orphans A (the grace is
// the diff's own design) and admits booking B. The suspended caller
// wakes; its runner child boots, loads A, and — from that pre-orphan
// snapshot — acquireLease + pid/door stamp + saveJob: A is silently
// resurrected to state:"running" with a live pid, behind the probe's
// back. The store now carries TWO running, live-pid Jobs for one
// program dir on one lineage session — the one-writer law
// admitAnotherJob exists to enforce is dead, and the orphan wake
// ("continue or abort it") already fired for a job that now claims
// running: whoever answers it with `whl continue A` drives a third.
//
// Deterministic, no timing, no stubs: the interleave is scripted —
// boot load, THEN the probe, THEN the rail's writes — exactly the
// snapshot→write gap the single-act law names. On BASE the probe does
// not exist: the second booking is refused by the running>0 veto, A
// is never flipped, and the stale write clobbers nothing (green).
test("the runner's open-ledger stamp does not resurrect a record the booking probe just orphaned", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-p13-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1: the door books it (state:"running", pid-less — the
    // pid lands only when the runner process boots and stamps it)
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )
    if (!first.ok) return
    const jobA = (first as { job: { id: string; sid: string } }).job
    const session = findSessionByHost("whitehartlane", resolve(prog))
    assert.ok(session, "sanity: the lineage session exists")

    // the caller is suspended before the runner boots: running,
    // pid-less, and TIME PASSES (2× the booking grace)
    const aDisk = loadJob(session!.id, jobA.id)
    assert.ok(aDisk, "sanity: booking 1's record is on disk")
    assert.equal(aDisk?.state, "running", "sanity: booking 1 is running")
    aDisk!.created = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    saveJob(aDisk!)

    // the runner child boots and opens its ledger — rail.ts:252 loads
    // the record ONCE (this snapshot still says running, pid-less)
    const staleChildCopy = loadJob(session!.id, jobA.id)
    assert.ok(staleChildCopy, "sanity: the runner's boot load sees the record")

    // while the child sits in the snapshot→write gap (node boot, lease
    // round-trip), the probe of a second `whl run` arrives: HEAD
    // orphans A (past the grace, no pid) and admits B. BASE refuses —
    // the veto held, the class cannot exist there (green).
    const second = prepareRun(prog)
    if (!second.ok) {
      assert.equal(
        loadJob(session!.id, jobA.id)?.state,
        "running",
        "BASE: the one-writer veto refused the second booking and left booking 1 untouched",
      )
      return
    }
    assert.equal(
      loadJob(session!.id, jobA.id)?.state,
      "orphaned",
      "sanity on HEAD: the probe orphaned the stale pid-less booking (the grace arm working as designed)",
    )

    // the child finishes booting and performs openLedger's writes —
    // under THE FIXED rail: the write site re-reads the disk FIRST
    // (single-act law), sees the probe's orphan, and STANDS DOWN —
    // no lease, no pid/door stamp, no resurrection. The model: the
    // child's write re-reads fresh; only a non-orphaned record is
    // written.
    const freshAtWrite = loadJob(session!.id, jobA.id)
    if (freshAtWrite?.state !== "orphaned") {
      acquireLease(freshAtWrite!, `orchestrator pid=${process.pid}`)
      freshAtWrite!.pid = process.pid
      freshAtWrite!.door = { rev: "repro", started: new Date().toISOString() }
      saveJob(freshAtWrite!)
    }

    // the one-writer law: ONE running Job per program dir on this
    // lineage session
    const running = listJobs(session!.id).filter((j) => j.state === "running")
    assert.equal(
      running.length,
      1,
      `INV-3/INV-4: the diff's single-act law ("re-read the record from disk before writing — a concurrent ` +
        `actor may have flipped it between this snapshot and the write", run.ts book()) was applied to the ` +
        `probe (run.ts:397), the sweep (bin single-act re-read), and the spawn beat (levy.ts:44 loadJob ?? job, ` +
        `whose own comment names the exact damage: "clobbering it with the stale object resurrects the orphan ` +
        `flip into a second live writer") — but NOT to the fourth writer, the runner's boot stamp ` +
        `(rail.ts:252 load → rail.ts:277 acquireLease → rail.ts:282-284 pid/door stamp + saveJob, all from the ` +
        `boot-time object with no re-read; saveJob at store.ts:432 persists the WHOLE stale object). After the ` +
        `probe orphaned booking ${jobA.id} (state on disk: "orphaned"), the rail's stale write resurrected it to ` +
        `"running" with a live pid: [${running.map((j) => `${j.id}${j.pid ? ` pid ${j.pid}` : ""}`).join(", ")}] ` +
        `now read running for ONE program dir on one lineage session — the split brain admitAnotherJob's veto ` +
        `exists to prevent — while the orphan wake ("continue or abort it") already fired for the revived job, ` +
        `so a mate answering it with \`whl continue ${jobA.id}\` drives a third writer. ` +
        `The incomplete-fix class: the twin the diff fixed (levy.ts) and the twin it left (rail.ts) write the ` +
        `same record on the same recovery path. On BASE the veto refused the second booking and this chain ` +
        `could not exist.`,
    )
    // and the record must carry the probe's honest verdict forward
    assert.equal(
      loadJob(session!.id, jobA.id)?.state,
      "orphaned",
      `INV-4: the runner's open-ledger write must carry the disk state forward — the probe's orphan receipt ` +
        `for ${jobA.id} — not clobber it from a pre-orphan snapshot (the record must not lie about who leads)`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
