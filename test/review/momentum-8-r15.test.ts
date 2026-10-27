import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum8-"))

import { prepareRun } from "../../src/doors/run.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-4 (claims are honest) — the diff's own manual states the
// dead-review recovery as a HARD RULE in three places:
//   bin/whitehartlane review --help: "a dead/stalled unit is NOT a dead
//     review: re-levy the SAME program dir (whl run <dir> --unattended)
//     — the settled fold spares done units; never materialize a fresh
//     program to retry"
//   templates/pr-review/ECONOMICS.md lever 2: "Re-levy, never
//     re-materialize … the r6/r8 receipts"
//   skills/yyx-whl/SKILL.md: "One law for this manual: a dead unit
//     re-levies the SAME program dir, never a fresh materialization"
//
// The diff built the fold (src/doors/run.ts copyBeside) to deliver the
// "spares done units" half — but the spell itself is the booking door,
// and the booking door refuses it after a KILLED run (the r5/r8 class
// ECONOMICS.md itself cites): createJob writes state:"running"
// (store.ts:410) and only the LIVE orchestrator ever moves it
// (finishJob/abortJob/pauseJob fire from rail.ts's runbook; orphanJob,
// the sweep that would flip a dead run, has NO production caller).
// book() then counts that zombie record — run.ts:379
// `listJobs(session.id).filter(job.state === "running")` — and
// admitAnotherJob (jev/policy.ts:26) refuses at running > 0. The
// lineage session is keyed by the program dir (resolveLineageSession →
// findSessionByHost("whitehartlane", dir)), so the re-levy of the SAME
// program dir is exactly the booking that sees the zombie.
//
// The path that breaks: a review (or any run) is killed — Ctrl-C,
// terminal closed, OOM, crashed boot. Every done unit sits settled in
// the prior ledger, the fold is ready to spare them, and the manual's
// own spell dies with "a job is already running (1)". The only path
// left is the fresh re-materialization the rule forbids — the r6b/r8b
// green-lens burn (ECONOMICS.md: ~450k input each) the whole lever
// exists to prevent. On BASE the fold did not exist and the same
// refusal did; this diff is the round that promised the law in its own
// manual and still did not make the door keep it — the incomplete-fix
// class.
test("the manual's re-levy spell books after a killed run — a dead Job record must not veto it", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-m8-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // run 1: the door books it (the levy). The process then dies — a
    // kill, a crash, the dead-review shape. No orchestrator ever
    // finishes/aborts/orphans the Job record, so it stays
    // state:"running" on the lineage session this program dir owns.
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: the first booking must admit (the fixture passes the door's own screens); got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )

    // the manual's hard rule, verbatim: re-levy the SAME program dir.
    // `whl run <prog> --unattended` is prepareRun(prog) again — nothing
    // else, no continue/abort detour is in the spell.
    const relevy = prepareRun(prog)
    assert.equal(
      relevy.ok,
      true,
      `INV-4: the diff's own manual (review --help hard rules; ECONOMICS.md lever 2; SKILL.md law) promises ` +
        `"re-levy the SAME program dir (whl run <dir> --unattended) — the settled fold spares done units; ` +
        `never materialize a fresh program to retry" — but the booking door refuses the spell while the ` +
        `killed run's Job record still reads state:"running" (createJob writes running; only the live ` +
        `orchestrator finishes/aborts; orphanJob has no production caller): ok=${String(relevy.ok)}, ` +
        `why=${relevy.ok ? "n/a" : (relevy as { why?: string }).why}. The prescribed recovery dead-ends in ` +
        `exactly the killed-review class (r5, r8) it exists for, leaving the forbidden fresh ` +
        `re-materialization as the only path.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
