import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m10-"))

import { prepareRun } from "../../src/doors/run.ts"
import { listJobs } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one liveness oracle, two opposite answers) — "is this pid-less
// running Job dead?" is decided twice in this repo:
//   - src/adapters/store.ts:940-942 (the lease oracle's doctrine):
//     "No parseable pid means we cannot prove the holder dead, so it
//     counts as ALIVE (conservative: one writer per job, always)"; and
//     store.ts:958-963: "ANY live holder means the rebirth must refuse"
//     — the split-brain rule.
//   - src/doors/run.ts:403-406 (this diff's booking probe, NOPID
//     branch): a running Job with no pid is unconditionally ORPHANED
//     ("abandoned booking") and the re-levy books past it.
// A pid-less running Job is not only the abandoned shape: it is ALSO
// the state of a booking whose runner spawn is still in flight —
// createJob saves state:"running" with no pid (store.ts:382-404), and
// the pid is written later by the CALLER's spawnRunner (levy.ts:41,
// job.pid = child.pid). Between prepareRun's return and that saveJob,
// a concurrent second booking of the same program dir probes the
// record, finds NOPID, orphans a job whose orchestrator is about to
// exist, and admits itself — two live orchestrators on one lineage
// session, and a wake demanding "continue or abort it" (store.ts:1028)
// for a job that is alive. The record now lies: state "orphaned" with
// no proof of death. The r15 case that motivated the probe (a
// SIGKILLed orchestrator) has a RECORDED pid — spawnRunner wrote it —
// and is fully served by the probe's pid-DEAD branch; the NOPID branch
// adds only this unprovable guess, inverting the store's own
// conservative doctrine on the same decision.
test("the booking probe does not orphan a booking whose runner spawn is still in flight", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-m10-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1: the door books it. prepareRun books WITHOUT spawning —
    // the spawn is the caller's (bin/whitehartlane → spawnRunner,
    // levy.ts:41). This is exactly the production record state between
    // book() and that saveJob: running, pid-less, orchestrator pending.
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: the first booking admits (got: ${first.ok ? "" : (first as { why?: string }).why})`)
    if (!first.ok || !("job" in first)) return
    const job1 = first.job
    assert.equal(job1.state, "running", "sanity: the booking is recorded running")
    assert.equal(job1.pid, undefined, "sanity: no runner has been spawned yet — pid-less")

    // booking 2: a concurrent `whl run <same dir>` (the re-levy spell,
    // or a double-submitted script) — same lineage session
    const second = prepareRun(prog)

    // the store's own doctrine: unprovable death counts ALIVE → the
    // veto holds → the second booking refuses (BASE behavior, and the
    // behavior while the first flow's spawnRunner is still pending)
    assert.equal(
      second.ok,
      false,
      `INV-3: "is this pid-less running Job dead?" is decided two opposite ways. store.ts:941 — the repo's own ` +
        `oracle doctrine — says "No parseable pid means we cannot prove the holder dead, so it counts as alive ` +
        `(conservative: one writer per job, always)", and store.ts:961-963 refuses a rebirth over ANY live holder. ` +
        `This diff's booking probe (run.ts:403-406) answers the same question the aggressive way: it orphaned the ` +
        `pid-less running Job ${job1.id} with no observed proof of death and ADMITTED the second booking ` +
        `(ok=${String(second.ok)}) — while the first booking's runner spawn was still in flight (createJob saves ` +
        `running with no pid; the pid lands later via spawnRunner, levy.ts:41). The orphan record lies, the wake ` +
        `demands "continue or abort it" for a live job (store.ts:1028), and two orchestrators can now drive one ` +
        `lineage session — the split brain the doctrine exists to prevent. The r15 killed-orchestrator case is ` +
        `served by the pid-DEAD branch (that job has a recorded pid); the NOPID branch is the unproven guess.`,
    )
    // and the first booking's record was not flipped behind its back
    const after = listJobs(job1.sid).find((j) => j.id === job1.id)
    assert.equal(
      after?.state,
      "running",
      `INV-3/INV-4: the probe flipped a booking whose runner spawn was pending to state="${after?.state}" ` +
        `(orphan.reason: ${after?.orphan?.reason ?? "n/a"}) — a live-intent booking recorded dead without proof`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
