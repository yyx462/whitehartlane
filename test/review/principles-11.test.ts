import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p11-"))

import { prepareRun } from "../../src/doors/run.ts"
import { listJobs } from "../../src/adapters/store.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin paths — "is this running Job abandoned?") / INV-4 (the
// doctor's verdict must be true). The diff canonicalized the answer in
// ONE place — store.ts bookingStale (store.ts:964-980), whose comment
// declares it "THE stale-booking oracle — the one answer ... shared by
// the booking probe (run.ts) and the sweep (bin)" — and rewired the
// sweep (bin:607) and the audit (bin:572) through it. The DOCTOR
// (bin:555) kept the pre-r17 private predicate:
//
//     const leased = jobs.filter((j) => j.state === "running" && !pidAlive(j.pid))
//
// Two divergences from the canonical oracle, both on the booking boot
// window — the state run.ts:385-388 itself calls "the NORMAL shape of
// every booking — a young pid-less record is a live intent, never an
// orphan":
//   1. no grace: bookingStale spares a pid-less record younger than
//      BOOKING_GRACE_MS; the doctor's raw filter does not;
//   2. `pidAlive(undefined)` is FALSE (undefined passes the
//      `pid === null` guard, lands in process.kill(undefined, 0),
//      throws TypeError, and the catch only counts EPERM as alive) —
//      the exact opposite of the oracle's own doctrine comment
//      ("unparseable/missing pid counts ALIVE"). bookingStale guards
//      undefined before calling live(); the doctor passes job.pid raw.
//
// So on HEAD the two verbs contradict on the same store: `whl doctor`
// goes RED — "N running without a live pid — sweep parks them" — while
// the very sweep it prescribes reports the job "left alone". The
// verdict is false (the booking IS a live intent) and the
// prescription is false (the sweep parks nothing). On BASE doctor and
// sweep agreed (the old local `if (!pid) return false` oracle made
// both aggressive) — the disagreement, and the false verdict on the
// normal booking path, are introduced by this change.
test("the doctor's live-jobs verdict agrees with the sweep's stale-booking oracle", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-p11-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // the booking boot window, exactly as production makes it:
    // prepareRun books WITHOUT spawning (the spawn is the caller's,
    // bin:393 spawnRunner) — a young running pid-less record
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: the booking must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )
    const booked = listJobs().find((j) => j.state === "running")
    assert.ok(booked, "sanity: one running Job booked on this store")
    assert.equal(booked?.pid, undefined, "sanity: the record is pid-less (pre-pid boot window)")

    // the doctor, on this store
    const doctor = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "doctor"],
      { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
    )
    // the sweep the doctor itself prescribes, on the same store
    const sweep = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "sweep"],
      { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
    )

    const liveJobsLine = (doctor.stdout ?? "").split("\n").find((l) => l.includes("live jobs")) ?? ""
    assert.match(
      liveJobsLine,
      /^ok\s+live jobs — every running Job has a live orchestrator/,
      `INV-3/INV-4: "is this running Job abandoned?" is answered by TWO oracles that disagree. ` +
        `The diff made store.ts bookingStale "THE stale-booking oracle — the ONE answer" (store.ts:964-980) ` +
        `and routed the sweep (bin:607) and the audit (bin:572) through it, but the doctor (bin:555) kept the ` +
        `pre-r17 private predicate \`!pidAlive(j.pid)\` — no booking grace, and pidAlive(undefined) answers DEAD ` +
        `(the TypeError path contradicts the oracle's own "missing pid counts ALIVE" doctrine). ` +
        `On the booking boot window the diff's own comment calls the NORMAL shape of every booking ` +
        `(run.ts:385-388), the doctor printed "${liveJobsLine.trim()}" while the sweep it prescribes printed ` +
        `"${(sweep.stdout ?? "").trim().split("\n")[0 ?? 0] ?? ""}" — a false verdict (the record IS a live intent) ` +
        `with a false prescription (the sweep parks nothing). On BASE both sites agreed; the divergence is ` +
        `introduced by this change. The doctor must route through bookingStale like every other site.`,
    )
    // and the sweep's own answer, for the record: the job is spared
    assert.match(
      (sweep.stdout ?? "") + (sweep.stderr ?? ""),
      /left alone/,
      "sanity: the canonical oracle spares the young pid-less booking — the sweep leaves it alone",
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
