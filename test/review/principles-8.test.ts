import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p8-"))

import { prepareRun } from "../../src/doors/run.ts"
import { listJobs, loadJob } from "../../src/adapters/store.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin paths — "is this pid-less running Job abandoned?") — the
// diff answers that question in TWO places with OPPOSITE answers:
//
//   - src/doors/run.ts:319-324 + 396-404 (the booking probe): a YOUNG
//     pid-less running record is a LIVE intent — 60s of grace, never an
//     orphan ("a YOUNG pid-less record is a live intent — never an
//     orphan"). It routes through the canonical oracle pidAlive and
//     only orphans on PROOF of death.
//
//   - bin/whitehartlane:94-96 (a LOCAL second oracle) + bin:615 (the
//     sweep): `if (!pid) return false` — a pid-less record answers
//     DEAD on sight, so `const pidGone = !pidAlive(job.pid)` is TRUE
//     for every pid-less running Job, no grace, no proof of death,
//     and orphanJob fires (bin:632). The store's own doctrine
//     (src/adapters/store.ts:940-942, quoted in pidAlive's own doc
//     comment at 948-953) says the opposite: "No parseable pid means
//     we cannot prove the holder dead, so it counts as ALIVE
//     (conservative: one writer per job, always)".
//
// The path that breaks — the manual's OWN recovery loop, interrupted:
// `whl run <dir>` books the Job (createJob persists state:"running"
// with no pid — the pid arrives only when the runner boots and stamps
// it, src/adapters/levy.ts:37 / rail.ts:282). The operator, following
// the manual's hard rule ("If the door refuses … run whl sweep, then
// re-levy" — bin:329-330), runs `whl sweep` while the booking is in
// that boot window. The sweep's twin oracle reads the live booking as
// "pid gone" and orphans it. The runner then boots, stamps its pid on
// the ORPHANED record (rail.ts:282 never checks state) and drives it —
// so the lineage session now carries a LIVE orchestrator whose record
// reads "orphaned": the next booking's probe skips it (state !==
// "running"), admitAnotherJob counts running=0, and a SECOND
// concurrent orchestrator is admitted — the split brain the veto
// exists to prevent, and the record lies (INV-4).
//
// Deterministic, no timing, no stubs: book once (prepareRun books
// WITHOUT spawning — the spawn is the caller's), run the sweep the
// manual prescribes, and demand the young pid-less record survive it.
test("the sweep does not orphan a young pid-less running Job — the probe's grace is the one law", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-p8-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1: the door books it. This is the exact live pre-pid
    // shape prepareRun itself returns (the spawn is the bin's job).
    const first = prepareRun(prog)
    assert.ok(
      first.ok,
      `sanity: the booking must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
    )
    const jobs1 = listJobs()
    assert.equal(jobs1.length, 1, "sanity: one job booked in this store")
    const job1 = jobs1[0]!
    assert.equal(job1.state, "running", "sanity: the booking is recorded running")
    assert.equal(job1.pid, undefined, "sanity: no runner has been spawned yet — pid-less")

    // the manual's own instruction (bin review --help hard rules:
    // "run 'whl sweep' … then re-levy"), run while booking 1 sits in
    // its boot window
    const sweep = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "sweep"],
      { encoding: "utf8", env: { ...process.env, AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME! } },
    )

    const after = loadJob(job1.sid, job1.id)
    assert.equal(
      after?.state,
      "running",
      `INV-3: "is this pid-less running Job abandoned?" is answered by TWO oracles that disagree. ` +
        `The booking probe (run.ts:319-324) just declared the law — "a YOUNG pid-less record is a live intent — ` +
        `never an orphan" — and the store's canonical oracle (store.ts:940-962) counts an unprovable holder ` +
        `ALIVE ("one writer per job, always"). But the sweep routes through bin/whitehartlane's LOCAL oracle ` +
        `(bin:94-96, \`if (!pid) return false\`) and orphaned the LIVE booking on sight: state now ` +
        `${JSON.stringify(after?.state)} (sweep stdout line 1: ${JSON.stringify(sweep.stdout.trim().split("\n")[0] ?? "")}), ` +
        `orphan.reason=${JSON.stringify(after?.orphan?.reason)}. The runner will stamp its pid on this ` +
        `orphaned record when it boots (rail.ts:282 checks no state) and drive it while the next booking ` +
        `admits a second orchestrator past the veto — the record lies, the split brain the probe's grace ` +
        `was written to prevent. The r15/r16 fix landed at the probe site and left the sweep twin wrong: ` +
        `the incomplete-fix class.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
