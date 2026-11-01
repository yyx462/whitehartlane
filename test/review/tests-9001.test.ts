import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the job store rides the OS-disk home — pin a private one before
// anything imports the store (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-t9001-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")

// Meta-ACH: mid-failure. The diff's claim-before-spawn (claimRevivalFlip,
// gate-r22 momentum-50) and its veto-before-claim reshape (gate-r25
// momentum-70) promise: "A refusal mutates nothing." The VETO refusal is
// guarded — but the SPAWN itself can still fail AFTER the claim:
// spawnRunner opens the child's log at join(job.dir, "orchestrator.log")
// with no try around it. A job whose run dir is gone between pause and
// continue (a cleanup hand, a stale ledger row — the store is the OS
// disk) makes openSync throw ENOENT — AFTER claimRevivalFlip has already
// flipped the record to running, DELETED its pause receipt, bumped
// continues, and SAVED. The failed hand-off leaves a lying record
// (state running, no pid, no pause receipt) — the exact residue
// momentum-70's fix pinned and removed for the veto arm, alive one step
// later on the spawn arm. On BASE the spawn was claimless: the same
// deleted-dir throw left the record PAUSED.
test("a spawn that fails after the claim leaves the parked record standing", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "whl-t9001-run-"))
  // the revival's runner door must EXIST so the door-missing refusal
  // (which fires before the claim) is not what stops the spawn — the
  // failure must land after the claim, at the log open
  writeFileSync(join(scratch, "door.mjs"), "process.exit(0)\n")
  process.env.AGENTIC_OS_ORCHESTRATOR = join(scratch, "door.mjs")
  try {
    const { findOrOpenSession, createJob, pauseJob, loadJob } = await import("../../src/adapters/store.ts")
    const { rebirthRunner } = await import("../../src/adapters/levy.ts")

    const { session } = findOrOpenSession({
      cwd: scratch,
      host: { tool: "test", session_id: "t9001", session_file: "t9001" },
    }) as { session: { id: string } }
    const sid = session.id

    // ── a real booked Job, drained to paused (the parked revival target)
    const runDir = join(scratch, "a")
    const a = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: runDir })
    pauseJob(a, "t9001: drained past the ceiling", 0)
    const parked = loadJob(sid, a.id)!
    assert.equal(parked.state, "paused", "sanity: A is parked on disk")
    assert.ok(parked.pause, "sanity: A carries its pause receipt")

    // ── the mid-failure shape: the run dir is gone when the revival is
    // attempted (cleanup hand between pause and continue)
    rmSync(runDir, { recursive: true, force: true })

    // ── the revival: the spawn fails (no log file to open) — AFTER the
    // claim has flipped and saved the record
    let threw: unknown = null
    try {
      rebirthRunner(parked, ROOT)
    } catch (err) {
      threw = err
    }

    // THE LAW (the diff's own): a failed hand-off mutates nothing — the
    // refusal ("no log to open") must leave the parked record standing,
    // exactly as the veto refusal does.
    const after = loadJob(sid, a.id)!
    assert.equal(
      after.state,
      "paused",
      `INV-4 (the record must not lie) / the claim's own law ("A refusal mutates nothing", gate-r25 ` +
        `momentum-70): spawnRunner orders claim BEFORE spawn, and the spawn itself can fail after the ` +
        `claim — the child log open (openSync join(job.dir, "orchestrator.log")) has no guard, so a job ` +
        `whose run dir vanished between pause and continue throws ENOENT AFTER claimRevivalFlip already ` +
        `flipped the record to running, deleted its pause receipt, bumped continues, and SAVED. The failed ` +
        `revival leaves state=${after.state} (wanted: paused), pause receipt ${JSON.stringify(after.pause ?? null)} ` +
        `(wanted: present), continues=${after.continues ?? 0}${threw ? `; the failure surfaced as a thrown ` +
        `${threw instanceof Error ? threw.constructor.name : typeof threw} escaping rebirthRunner` : ""} — ` +
        `the lying record momentum-70's own fix promised could not happen, one step later than the arm it ` +
        `fixed. The spawn must be guarded (openSync inside try) and the claim rolled back on failure, or ` +
        `the log must be opened before the claim.`,
    )
    assert.ok(
      after.pause,
      `INV-4: the pause receipt was erased by a revival whose SPAWN never happened (receipt: ${JSON.stringify(after.pause ?? null)})`,
    )
  } finally {
    delete process.env.AGENTIC_OS_ORCHESTRATOR
    rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
    rmSync(HOME, { recursive: true, force: true })
  }
})
