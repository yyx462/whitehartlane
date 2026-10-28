import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-questions3-"))

import { prepareRun } from "../../src/doors/run.ts"
import { saveJob } from "../../src/adapters/store.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// QUESTIONS.md #6 (mid-flight states: death) / INV-3 (one function per
// decision — "is this running Job's orchestrator alive"). The diff's
// booking probe (src/doors/run.ts book()) reimplements the liveness
// oracle the store already owns — pidAlive (src/adapters/store.ts:948)
// — and drops its EPERM arm: `process.kill(pid, 0)` in a bare
// try/catch treats ANY error as death, but EPERM means the process is
// ALIVE and this uid may not signal it (the store's own oracle returns
// alive for EPERM precisely so "one writer per job, always",
// store.ts:941-948). An orchestrator running under another uid (shared
// host, sudo-launched) answers EPERM: the probe declares it gone,
// orphans a LIVE job (false orphan receipt + a "continue or abort it"
// wake), and books a SECOND writer against it. On BASE the booking was
// refused while any running job existed (admitAnotherJob) — the hole
// is introduced by this diff.
test("the booking probe does not orphan a running Job whose pid answers EPERM", () => {
  // premise: pid 1 (launchd) is alive and answers EPERM for this uid.
  // Under root there is no EPERM, so the scenario cannot exist there —
  // fail the premise loudly instead of passing vacuously.
  let eperr: string | null = null
  try {
    process.kill(1, 0)
  } catch (err) {
    eperr = (err as NodeJS.ErrnoException).code ?? String(err)
  }
  assert.equal(
    eperr,
    "EPERM",
    `premise: a live process this uid may not signal must answer EPERM (got: ${eperr ?? "kill succeeded"}); under root the EPERM class does not exist and this scenario is untestable`,
  )

  const prog = mkdtempSync(join(tmpdir(), "whl-q3-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })
    // booking 1: the door books it; the runner then records its
    // orchestrator pid via the pid event. Stand in for an orchestrator
    // this uid cannot signal: pid 1 — ALIVE, kill(0) → EPERM.
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: the first booking must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    const job = first.ok ? first.job : null
    assert.ok(job, "sanity: booking returned the Job record")
    if (!first.ok || !job) return
    job.pid = 1
    saveJob(job)

    // booking 2: the manual's re-levy spell against the SAME program
    // dir. The probe must PROVE the orchestrator dead before orphaning
    // it — EPERM is proof of life (the store's own oracle says so).
    // A live orchestrator vetoes the second booking (admitAnotherJob).
    const relevy = prepareRun(prog)
    assert.equal(
      relevy.ok,
      false,
      `INV-3/INV-4: the booking probe (src/doors/run.ts book()) reimplements liveness with a bare try/catch around ` +
        `process.kill(pid, 0), so EPERM — a LIVE process this uid may not signal (store.ts pidAlive returns ALIVE ` +
        `for EPERM, "one writer per job, always") — is misread as death: the probe orphaned a live Job and booked ` +
        `a second writer against it (relevy.ok=${String(relevy.ok)}, why=${relevy.ok ? "n/a" : (relevy as { why?: string }).why}). ` +
        `On BASE the booking was refused while any running Job existed; the hole is introduced by this diff.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
