import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests11-"))

import { prepareRun } from "../../src/doors/run.ts"
import { findSessionByHost, listJobs, saveJob } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin liveness oracles) — store.ts pidAlive (the repo's
// canonical answer to "is this pid alive"): EPERM from
// process.kill(pid, 0) is ALIVE — "a live process this uid may not
// signal" — under the stated law "one writer per job, always". The
// diff's booking probe (src/doors/run.ts book()) hand-rolls the same
// decision as a bare try/catch: ANY throw ⇒ dead ⇒ orphanJob + book
// past it. On a host where the orchestrator runs under another uid or
// a hardened/hardened-namespace context (containers, CI runners), the
// probe reads a LIVE run as dead: it orphans the record and books a
// second writer against a running job. The canonical oracle was
// already in the repo — the probe reimplemented it with the opposite
// conservatism instead of calling it.
//
// Deterministic repro: booking 1 carries a live pid (process.pid);
// around booking 2, process.kill answers EPERM for that pid exactly as
// the kernel would for a foreign-uid live process. The repo's own
// oracle says: veto. The probe's twin says: orphan and admit — the
// assertion below fails on HEAD.
test("the booking probe does not orphan a running Job whose pid answers EPERM", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-t11-prog-"))
  const realKill = process.kill.bind(process)
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1: live, pid attached (the runner reported it — the same
    // fiction test/run.test.ts pins, for the same reason)
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: booking 1 admits; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    const session = findSessionByHost("whitehartlane", prog)
    assert.ok(session, "sanity: the lineage session exists")
    const job1 = session ? listJobs(session.id).find((j) => j.id === (first as { job: { id: string } }).job.id) : undefined
    assert.ok(job1, "sanity: booking 1's Job row is listed")
    job1!.pid = process.pid
    saveJob(job1!)

    // the kernel answering for a live foreign-uid process: EPERM
    type KillFn = (pid: number, sig?: number | string) => unknown
    const proc = process as unknown as { kill: KillFn }
    proc.kill = (pid: number, sig?: number | string) => {
      if (Number(sig ?? 0) === 0 && pid === process.pid) {
        const err = new Error("operation not permitted") as NodeJS.ErrnoException
        err.code = "EPERM"
        throw err
      }
      return realKill(pid, sig as NodeJS.Signals)
    }
    let second: ReturnType<typeof prepareRun>
    try {
      second = prepareRun(prog)
    } finally {
      proc.kill = realKill
    }

    assert.equal(
      second.ok,
      false,
      `INV-3: "is this pid alive?" is decided twice with opposite answers — store.ts pidAlive returns ` +
        `ALIVE for EPERM (a live process this uid may not signal; "one writer per job, always") while ` +
        `the diff's booking probe (run.ts book()) wraps process.kill(pid, 0) in a bare try/catch and ` +
        `reads ANY throw as death. With job ${job1!.id} live at pid ${process.pid} and the kernel ` +
        `answering EPERM, the probe orphaned it (state now: ` +
        `${listJobs(session!.id).find((j) => j.id === job1!.id)?.state}) and booked a second writer: ` +
        `second.ok=${String(second.ok)}, why=${second.ok ? "n/a (admitted)" : (second as { why?: string }).why}. ` +
        `The repo's own oracle — and BASE, with no probe — refuse the booking while any running Job exists.`,
    )
  } finally {
    process.kill = realKill
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
