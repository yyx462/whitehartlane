import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests10-"))

import { prepareRun } from "../../src/doors/run.ts"
import { findSessionByHost, listJobs } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin liveness oracles) / the store's own one-writer law —
// store.ts pidAlive: "No parseable pid means we cannot prove the holder
// dead, so it counts as alive (conservative: one writer per job,
// always)". The diff's booking probe (src/doors/run.ts book()) answers
// the SAME question the OPPOSITE way for the no-pid shape: state
// "running" + no pid ⇒ ORPHAN, book past it. But "running + no pid" is
// not proof of abandonment — it is the NORMAL shape of every booking
// between book() (createJob persists state:"running", pid undefined)
// and the runner's pid event. prepareRun's own return value proves the
// window exists. A second booking arriving in that window (a retry, an
// impatient re-run of the spell) orphans the LIVE booking's record and
// books a SECOND concurrent run of the same program — the exact
// double-levy admitAnotherJob's running>0 veto exists to prevent, and
// the veto is defeated by an unprovable death certificate.
//
// Deterministic, no stubs, no timing: book once, book again
// immediately. BASE refused the second booking (no probe; running=1);
// HEAD orphans and admits it.
test("the booking probe does not orphan a live pre-pid booking — unprovable death stays a veto", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-t10-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1: the door books it. This is the exact state the manual's
    // spell leaves while the runner is booting: a running Job, no pid.
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: the first booking must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )
    const session = findSessionByHost("whitehartlane", prog)
    assert.ok(session, "sanity: the lineage session exists after booking 1")
    const job1 = session ? listJobs(session.id).find((j) => j.id === (first as { job: { id: string } }).job.id) : undefined
    assert.ok(job1, "sanity: booking 1's Job row is listed")
    assert.equal(job1?.state, "running", "sanity: booking 1 is running")
    assert.equal(job1?.pid, undefined, "sanity: booking 1 has no orchestrator pid yet — the live pre-pid shape prepareRun itself returns")

    // the second booking, arriving while booking 1 is alive-but-pre-pid
    // (a retry of `whl run <same dir> --unattended`). The repo's
    // conservative law: unprovable death ⇒ still alive ⇒ veto. BASE
    // vetoed ("a job is already running (1)").
    const second = prepareRun(prog)
    assert.equal(
      second.ok,
      false,
      `INV-3/the store's one-writer law: "is this running Job's orchestrator provably dead?" is decided ` +
        `TWO opposite ways — store.ts pidAlive counts unprovable as ALIVE ("one writer per job, always") ` +
        `while the diff's booking probe (run.ts book()) counts no-pid as DEAD and orphans it. ` +
        `"Running + no pid" is not abandonment: createJob persists state:"running" with pid undefined, ` +
        `and the pid arrives only later via the runner's event — prepareRun's own booking 1 returned ` +
        `exactly that shape (job ${job1?.id}, state=${job1?.state}, pid=${String(job1?.pid)}). ` +
        `The probe orphaned the LIVE booking (state now: ${job1 ? listJobs(session!.id).find((j) => j.id === job1.id)?.state : "?"}) ` +
        `and booked a SECOND concurrent run: second.ok=${String(second.ok)}, ` +
        `why=${second.ok ? "n/a (admitted)" : (second as { why?: string }).why}. ` +
        `The manual's re-levy spell, double-invoked during the runner's boot, now runs two orchestrators ` +
        `and levies twice — the double-levy admitAnotherJob's veto exists to prevent. ` +
        `On BASE the second booking was refused.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
