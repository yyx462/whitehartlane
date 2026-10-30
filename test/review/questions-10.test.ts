import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the unit ledger rides the OS-disk trace — pin a private home (the
// repo's own repro convention) before anything reads it
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-q10-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"
import { continueJob, createJob, failJob, loadJob, openSession, pauseJob } from "../../src/adapters/store.ts"

// INV-4 (the record is honest) / INV-6 (a terminal receipt must not be
// unwound by a raced revival) — the single-act law's own words, written
// by this diff INTO continueJob (store.ts, "the FIFTH writer joins the
// single-act law"):
//   "The FRESH record decides: a receipt that differs from the
//    caller's snapshot STANDS (the operator superseded the revival)"
// The guard implements that law for pause/abort/orphan — but excludes
// "retired" from the differing-receipt set
// (`superseded = fresh.state !== job.state && fresh.state !== "running" && fresh.state !== "retired"`,
// store.ts:1087). Yet retired IS a differing receipt the revival window
// can hold, written by the fail button: `whl fail` refuses only RUNNING
// jobs (bin:1118), failJob's own guard is `state === "running"` only,
// and it writes state:"retired" + finished + a failed receipt. And
// retired is not continuable by design — `whl continue` refuses it at
// the door (bin:824 "not paused/aborted/orphaned"). So the ONLY way
// continueJob ever sees fresh.state === "retired" is the exact race the
// law was written for: the revival verb (whl continue / whl refresh —
// whose snapshot spans a minutes drain or 30s-per-pane straggler
// retire) holds a paused/orphaned snapshot, the operator presses the
// fail button mid-ceremony, and the ceremony's tail write resurrects
// the job: state := "running", finished := undefined, the failed
// receipt deleted — while the mate the fail wake already fired at has
// been told the run FAILED. The record lies about who leads, the exact
// split-brain shape the law's own text names.
//
// The window is scripted, not timed (the principles-33 device): boot
// snapshot, THEN the fail, THEN the ceremony's continue write.
test("a fail-button receipt landing in the revival window STANDS — retired is a differing receipt, not a continuable one", () => {
  const session = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "questions-10 revive window",
    runDir: true,
  })

  // the parked generation: the revival verb loads its snapshot now
  // (refresh's drain parked it — ADR 5)
  pauseJob(loadJob(session.id, job.id)!, "drain", 0)
  const snapshot = loadJob(session.id, job.id)!
  assert.equal(snapshot.state, "paused", "sanity: the record reads paused when the revival verb loads it")

  // IN THE WINDOW (the drain is minutes; the retire loop is 30s per
  // straggler pane): the operator presses the fail button — legal on a
  // parked job (bin refuses only running), and failJob's own guard
  // refuses only running. The FRESH record is loaded, as every actor
  // must.
  const failed = failJob(loadJob(session.id, job.id)!, "operator failed the parked run mid-revival")
  assert.ok(failed, "sanity: the fail button accepts a paused job")
  assert.equal(
    loadJob(session.id, job.id)?.state,
    "retired",
    "sanity: the fail receipt stands on disk before the ceremony's write",
  )

  // the ceremony's tail, exactly as rebirthRunner performs it:
  // continueJob(job-snapshot, child pid)
  continueJob(snapshot, 424242)

  const after = loadJob(session.id, job.id)!
  assert.equal(
    after.state,
    "retired",
    `INV-4/INV-6: the revival's continue write must answer to the disk, not to the boot snapshot. ` +
      `continueJob's own law says "a receipt that differs from the caller's snapshot STANDS (the operator ` +
      `superseded the revival)" — but the guard excludes "retired" from the differing-receipt set ` +
      `(store.ts:1087: fresh.state !== "retired" is a NEGATIVE condition), so the fail button's terminal ` +
      `receipt — written mid-ceremony by the one verb that legally writes retired on a parked job — does ` +
      `NOT stand: the record was resurrected to ${after.state} with finished=${JSON.stringify(after.finished ?? null)} ` +
      `and receipt.status=${JSON.stringify(after.receipt?.status ?? null)} erased, pid 424242 stamped. ` +
      `retired is not continuable by design (bin continue refuses it: "not paused/aborted/orphaned"), so the ` +
      `exclusion has no legitimate writer — only this race — and the mate the fail wake already fired at now ` +
      `faces a job that reads running after its own failed verdict. The receipt must stand, like the ` +
      `pause/abort/orphan receipts the same guard honors (principles-33).`,
  )
  assert.ok(
    after.finished !== undefined && after.receipt?.status === "failed",
    `INV-4: the fail receipt must survive a raced revival write — the record must keep telling the truth ` +
      `about why the run stopped (got finished=${JSON.stringify(after.finished ?? null)}, ` +
      `receipt=${JSON.stringify(after.receipt ?? null)})`,
  )

  rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
})
