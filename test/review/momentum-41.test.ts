import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum41-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// BASE shape guard: the booking probe is this diff's own addition (the
// tests-102 device — vacuous green there, so the prove gate classifies
// introduced). The store imports ride below the guard: bookingStale and
// the probe do not exist on BASE.
if (!readFileSync(join(ROOT, "src", "doors", "run.ts"), "utf8").includes("booking probe")) {
  test("momentum-41: BASE — no booking probe, nothing to judge", () => {})
} else {
  const { prepareRun } = await import("../../src/doors/run.ts")
  const { acquireLease, findSessionByHost, loadJob, saveJob } = await import("../../src/adapters/store.ts")

  // INV-3 (one decision, one place — "is this running Job abandoned?") /
  // INV-4 (the probe must not call a live run dead) / INV-6 (the orphan
  // wake fires once, for a commission that is really gone).
  //
  // This diff's booking probe (run.ts book()) decides "stale" SOLELY
  // through store.ts bookingStale, which reads ONLY the record fields:
  // state running + recorded pid proven dead → orphanJob. The lease —
  // the repo's ONE one-writer authority (j-93d652 gap #2, the mutex
  // half) — lives ON THE SAME RECORD, and the probe never reads it.
  //
  // The shape that breaks is the double-continue residue the lease
  // itself exists to arbitrate (j-93d652's own named threat): two
  // revival ceremonies interleave; the lease crowns the FIRST child's
  // runner, the record's pid field ends holding the SECOND child (the
  // lease's loser — spawnRunner's fresh-pid stamp and continueJob's
  // tail both write the pid unconditionally), and that loser dies at
  // the lease the moment it boots. The store now says two things at
  // once: record.pid = dead (the loser), record.lease = LIVE (the
  // winner, still beating the job). This diff's new probe acts on the
  // dead half: it orphans a job whose live lease-holder is mid-beat,
  // fires the mate wake ("continue or abort it") for a commission that
  // is still running, and admits a successor booking beside the leader.
  //
  // Deterministic: the interleave is scripted as the post-race store
  // shape (no timing); the leader is a real live process. On BASE there
  // is no probe and no admit beside a running job: the re-levy refuses,
  // the job stays running — green there (introduced).
  test("the booking probe must not orphan a running Job whose lease names a live holder", async () => {
    const prog = mkdtempSync(join(tmpdir(), "whl-m41-prog-"))
    cpSync(FIXTURE, prog, { recursive: true })
    const leader = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" })
    try {
      // booking 1: the door books it (running, pid-less)
      const first = prepareRun(prog)
      assert.ok(first.ok, `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`)
      if (!first.ok) return
      const jobA = (first as { job: { id: string; sid: string } }).job
      const session = findSessionByHost("whitehartlane", prog)
      assert.ok(session, "sanity: the lineage session exists")

      // ── the double-continue residue, scripted (the interleave that
      // produces it lives at continueJob/spawnRunner — see momentum-40):
      // the record's pid holds the lease's LOSER (dead the moment it
      // boots); the lease names the WINNER (alive, beating the job).
      const loser = spawnSync("true").pid as number
      const disk = loadJob(session!.id, jobA.id)!
      disk.pid = loser
      saveJob(disk)
      acquireLease(loadJob(session!.id, jobA.id)!, `orchestrator pid=${leader.pid}`)

      // premise: the store says two things at once — the raced record
      const seeded = loadJob(session!.id, jobA.id)!
      assert.equal(seeded.state, "running", "premise: the record still reads running")
      assert.equal(seeded.pid, loser, "premise: the record's pid holds the lease's loser")
      assert.ok(leader.pid && process.kill(leader.pid, 0), "premise: the lease's holder is a live process")
      assert.equal(seeded.lease ? seeded.lease.holder : null, `orchestrator pid=${leader.pid}`, "premise: the lease crowns the live leader on this very record")

      // ── the re-levy: the booking probe reads the record. The lease
      // answers "one writer, and it is alive" — the probe must stand
      // down. At HEAD it reads only the dead pid half: orphanJob fires
      // on a live run, the mate wake lies, and the successor booking
      // admits beside the leader.
      const second = (await prepareRun(prog)) as { ok: boolean; why?: string }

      const j0 = loadJob(session!.id, jobA.id)
      assert.notEqual(
        j0?.state,
        "orphaned",
        `INV-3/INV-4/INV-6: "is this running Job abandoned?" is answered by this diff's booking probe through ` +
          `bookingStale ALONE — record state + recorded pid — while the ONE one-writer authority, the lease, rides ` +
          `the same record and names a LIVE holder. The double-continue race leaves the record's pid holding the ` +
          `lease's loser (the loser dies at the lease the moment it boots) with the winner's lease live on the same ` +
          `record; the probe orphaned it anyway (state now ${JSON.stringify(j0?.state)}): a live, mid-beat run is ` +
          `booked dead, the mate wake fires for a commission that is still running (one wake per commission, ` +
          `broken), and the re-levy ${second.ok ? "ADMITTED a successor booking" : "refused"} beside the live ` +
          `leader. The probe must read the whole record it orphans on: a lease whose holder is alive is the repo's ` +
          `own answer that this job is NOT abandoned (store.ts liveLeaseHolder) — bookingStale must fold it in, ` +
          `or the probe must ask it before booking a live run dead.`,
      )
      assert.equal(
        second.ok,
        false,
        `INV-3: the re-levy must not admit a successor beside a job whose live lease-holder is still its writer — ` +
          `at HEAD the probe's orphan admitted one (the split brain admitAnotherJob and the successor veto exist ` +
          `to prevent, reached because the probe trusted the raced pid half and ignored the lease half).`,
      )
    } finally {
      try {
        if (leader.pid) process.kill(leader.pid, "SIGKILL")
      } catch {
        /* already gone */
      }
      rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
      rmSync(prog, { recursive: true, force: true })
    }
  })
}
