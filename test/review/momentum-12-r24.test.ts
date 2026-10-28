import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum12-"))

import { prepareRun } from "../../src/doors/run.ts"
import { findSessionByHost, listJobs, loadJob, saveJob } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place — "is a successor booking live on this
// program dir?") / INV-4 (the stale wake must not revive a second writer).
//
// The diff's booking probe (run.ts book()) orphans a dead-pid running Job
// and admits a successor; store.ts orphanJob fires the mate wake
// ("continue or abort it"). The diff's OWN answer to that stale wake is
// the successor veto in bin/whitehartlane continue (r23 questions-5):
//   const successor = jobs.find(
//     (j) => j.id !== job.id && j.dir === job.dir && j.state === "running" && !bookingStale(j, Date.now()),
//   )
// But `whl run` books every job with its OWN run dir (run.ts book():
// createJob({ runDir: true }) → dir = sessions/<sid>/jobs/<jid>/run), so
// the successor booking's j.dir NEVER equals the orphaned job's dir. The
// veto is vacuous on the exact path its comment names ("a mate answering
// this Job's own 'continue or abort it' wake must not revive it beside a
// successor booking the booking probe just admitted").
//
// The path that breaks (the manual's own recovery, one wake answered):
//   1. `whl run <dir>` books job A; the runner SIGKILLs after stamping
//      its pid (the r15 killed-review shape: a RECORDED, now-dead pid).
//   2. The re-levy spell: `whl run <dir>` — the probe orphans A (dead
//      pid is proven death) and admits successor B.
//   3. The mate answers the wake: `whl continue A`. The veto compares
//      B.dir === A.dir — never true — so nothing vetoes; rebirthRunner
//      spawns a fresh runner for A beside live successor B: two live
//      writers on one lineage session, the split brain admitAnotherJob
//      and this veto exist to prevent, and continueJob erases A's
//      orphan receipt (the record stops telling the truth about who
//      leads).
//
// Deterministic: the interleave is scripted, the rebirth door is a stub
// that exits immediately (AGENTIC_OS_ORCHESTRATOR), no timing. On BASE
// the probe does not exist: the second booking is refused by the
// running>0 veto, A stays running, and the scenario cannot exist (green).
test("continue refuses the stale orphan wake while a successor booking is live on the program", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-m12-prog-"))
  cpSync(FIXTURE, prog, { recursive: true })
  // the rebirth door is a stub: the veto must fire BEFORE any spawn —
  // if continue proceeds far enough to spawn, the veto already missed
  const stub = join(mkdtempSync(join(tmpdir(), "whl-m12-door-")), "orchestrator.mjs")
  writeFileSync(stub, "process.exit(0)\n")
  try {
    // booking 1: the door books it; the runner then dies AFTER stamping
    // its pid — emulated exactly (a genuinely dead pid on the record)
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    if (!first.ok) return
    const jobA = (first as { job: { id: string; sid: string } }).job
    const session = findSessionByHost("whitehartlane", prog)
    assert.ok(session, "sanity: the lineage session exists")

    const dead = spawnSync("true")
    const aDisk = loadJob(session!.id, jobA.id)!
    aDisk.pid = dead.pid // exited process — the probe reads it as dead
    saveJob(aDisk)

    // the re-levy spell: the probe orphans A and admits successor B.
    // On BASE there is no probe: the veto refuses the second booking
    // and this scenario cannot exist — the repro ends green there.
    const relevy = prepareRun(prog)
    if (!relevy.ok) {
      assert.equal(
        loadJob(session!.id, jobA.id)?.state,
        "running",
        "BASE: the one-writer veto refused the second booking; no successor exists to race",
      )
      return
    }
    assert.equal(
      loadJob(session!.id, jobA.id)?.state,
      "orphaned",
      "sanity on HEAD: the probe orphaned the dead-pid booking (the r15 arm working as designed)",
    )
    const successor = listJobs(session!.id).find((j) => j.id !== jobA.id && j.state === "running")
    assert.ok(successor, "sanity on HEAD: the successor booking B is live on the lineage session")

    // the mate answers the wake. The diff's successor veto must refuse
    // it: the veto's own comment says a live successor makes "the
    // stale-orphan wake ... stale too".
    const cli = spawnSync(process.execPath, ["bin/whitehartlane", "continue", jobA.id], {
      cwd: join(import.meta.dirname, "..", ".."),
      encoding: "utf8",
      env: { ...process.env, AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME, AGENTIC_OS_ORCHESTRATOR: stub },
      timeout: 30_000,
    })
    assert.equal(
      cli.status,
      2,
      `INV-3/INV-4: the continue verb's successor veto keys on j.dir === job.dir (bin/whitehartlane continue), but ` +
        `\`whl run\` books every job with its own run dir (run.ts book(): createJob({ runDir: true })), so the ` +
        `probe-admitted successor ${successor?.id} (dir ${successor?.dir}) never matches the orphaned job's dir ` +
        `(${jobA.id}, dir ${aDisk.dir}) — the veto is vacuous on the exact path its comment names ("a mate answering ` +
        `this Job's own 'continue or abort it' wake must not revive it beside a successor booking the booking probe ` +
        `just admitted"). The stale wake went through: exit=${cli.status}, stdout=${JSON.stringify(cli.stdout)}, ` +
        `stderr=${JSON.stringify(cli.stderr)} — rebirthRunner spawned job ${jobA.id} beside live successor ` +
        `${successor?.id}: two live writers on one lineage session (the split brain admitAnotherJob and this veto ` +
        `exist to prevent), and continueJob erased the orphan receipt the record just carried. The veto must key ` +
        `on what actually identifies the program (the lineage session + spur/program identity, the twin the fold ` +
        `uses), not the per-job run dir.`,
    )
    assert.match(
      cli.stderr,
      /successor/,
      `the refusal must name the successor (the veto's own message), not fall through to a rebirth: got ${JSON.stringify(cli.stderr)}`,
    )
    // and the record must keep the probe's honest verdict — continueJob
    // must not have erased the orphan receipt behind the veto's back
    assert.equal(
      loadJob(session!.id, jobA.id)?.state,
      "orphaned",
      `INV-4: the orphaned record must keep its receipt until a LEGAL revival — after the refused continue it read ` +
        `${JSON.stringify(loadJob(session!.id, jobA.id)?.state)} (continueJob reset it to running beside successor ` +
        `${successor?.id}): the record lies about who leads`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
    rmSync(join(stub, ".."), { recursive: true, force: true })
  }
})
