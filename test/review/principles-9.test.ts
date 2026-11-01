import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p9-"))

import { prepareRun } from "../../src/doors/run.ts"
import { findSessionByHost, listJobs, loadJob, saveJob } from "../../src/adapters/store.ts"
import { resolve } from "node:path"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin shapes for one record) / INV-4 (the probe's own comment
// claims "record it honestly") — the booking probe orphans a zombie
// Job through store.ts orphanJob(job, reason, panesRemaining), whose
// THIRD parameter is declared required (store.ts:1021, the JobRecord
// orphan shape store.ts:141 `panesRemaining: number`). The probe calls
// it with TWO arguments (run.ts:402 dead-pid branch, run.ts:405
// no-pid branch). --experimental-strip-types strips types without
// checking them, so the call runs and silently persists
// orphan.panesRemaining: undefined — the field is DROPPED from the
// saved JSON. The repo's other orphaning site, the sweep
// (bin/whitehartlane:629), passes a live pane count; the event-replay
// projection (store.ts:1145) coerces the missing event field with
// Number(e.panesRemaining ?? 0) → 0. One decision — "record the
// orphan" — three shapes: a counted number (sweep), a coerced 0
// (replay), and a missing field (the probe's persisted record).
//
// The path that breaks: the manual's own recovery spell — any
// re-levy after a killed run whose orchestrator had already stamped
// its pid (rail.ts:282, the NORMAL killed-review shape). The probe
// books past the zombie (the r15 fix works) and writes the malformed
// record on the exact path this diff was written to serve.
test("the booking probe's orphan record carries a panesRemaining count, like the sweep's", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-p9-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // run 1: the door books it. The runner then dies AFTER stamping its
    // pid (the r5 killed-review shape: rail.ts stamps pid at open) —
    // emulated exactly: stamp a genuinely dead pid onto the record.
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: the first booking must admit: ${(first as { why?: string }).why}`)
    const session = findSessionByHost("whitehartlane", resolve(prog))
    assert.ok(session, "sanity: the lineage session exists")
    const jobs1 = listJobs(session!.id)
    assert.equal(jobs1.length, 1, "sanity: one job booked")
    const dead = spawnSync("true")
    const j1 = loadJob(session!.id, jobs1[0]!.id)!
    j1.pid = dead.pid // exited process — the probe must see it gone
    saveJob(j1)

    // the manual's spell: re-levy the SAME program dir
    const relevy = prepareRun(prog)
    assert.equal(relevy.ok, true, `sanity: the probe must book past the killed run (the r15 fix): ${(relevy as { why?: string }).why}`)

    const orphaned = listJobs(session!.id).find((j) => j.id === jobs1[0]!.id)!
    assert.equal(orphaned.state, "orphaned", "sanity: the zombie was orphaned by the probe")
    const fresh = loadJob(session!.id, orphaned.id)!
    assert.equal(
      typeof fresh.orphan?.panesRemaining,
      "number",
      `INV-3/INV-4: the booking probe calls orphanJob WITHOUT its declared-required third argument ` +
        `(run.ts:402 — orphanJob(job, reason) vs store.ts:1021 — orphanJob(job, reason, panesRemaining)); ` +
        `strip-types does not typecheck, so the persisted record drops panesRemaining entirely ` +
        `(got ${JSON.stringify(fresh.orphan)}) — the probe's own comment claims "record it honestly", and the ` +
        `sweep's twin call (bin/whitehartlane:629) records a counted number while the replay projection ` +
        `(store.ts:1145) reads this record back as 0. One record, three shapes, on the diff's own ` +
        `recovery path (the re-levy after a killed run).`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
