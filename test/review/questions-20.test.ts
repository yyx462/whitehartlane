// questions-20 (questions lens, Q2/Q3) — THE VERDICT SEAT STILL FLIPS THE
// PROGRAM'S IDENTITY for the "program changed since booking" comparison.
//
// The change states the law itself (src/doors/run.ts:216-220):
//   "the verdict SEAT is output, never input: its presence (a link into
//    the run dir) or absence must not change the program's identity —
//    the fold's 'same program?' judgment cannot flip on a seat
//    (2026-10-30, the 'program changed since booking' strand)"
//
// It fixed HALF of it: the FOLD's identity (copyBeside's `data` field,
// src/doors/run.ts:220) excludes review/verdict.json. The TWIN — the
// spur's version, the hash book() records at src/doors/run.ts:457
// (`const version = contentHashOf(dir)`) — does NOT exclude it, and that
// is the very hash "program changed since booking" compares:
//   src/adapters/store.ts:852  failedWakeWhy → "failed — program changed
//                              since booking: `whl continue` re-runs the
//                              verdict on the same work"
//   bin/whitehartlane:1196    the continue note → "the program source
//                              changed since booking; this rebirth runs the
//                              EDITED program"
//
// The seat is minted BY the booking (stageRun → linkVerdictSeat(source,
// store), src/doors/run.ts:127) — i.e. AFTER the version was computed at
// line 457 — so the two hashes can never agree again. Every `whl continue`
// on a program dir reports a phantom edit, and every failed run's wake
// carries the phantom hint, both caused by the seat the booking itself
// created.
//
// The repro uses the repo's OWN three pieces — the hasher
// (src/doors/project.ts contentHashOf), the seat's shape (a symlink at
// <program>/data/review/verdict.json → <job run dir>/data/review/verdict.json)
// and the CONSUMER (src/adapters/store.ts failedWakeWhy). The seat is
// written by hand so this file loads on BASE too (BASE has no
// linkVerdictSeat).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { failedWakeWhy, type JobRecord } from "../../src/adapters/store.ts"
import { contentHashOf } from "../../src/doors/project.ts"

test("questions-20: the verdict seat must not change the program's identity", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q20-seat-"))
  try {
    const prog = join(tmp, "prog")
    const runDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    mkdirSync(join(runDir, "data", "review"), { recursive: true })
    writeFileSync(join(prog, "data", "review", "config.sh"), "REPO='/tmp/x'\n")
    // the run dir's verdict — prove.sh's output, the seat's target
    writeFileSync(join(runDir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))

    // what the booking RECORDS: contentHashOf(dir) at src/doors/run.ts:457,
    // computed BEFORE the staging that mints the seat
    const booked = contentHashOf(prog)

    // THE SEAT, byte-for-byte what linkVerdictSeat writes (src/doors/run.ts:142-151):
    // a symlink at <program>/data/review/verdict.json → <run dir>/data/review/verdict.json
    symlinkSync(join(runDir, "data", "review", "verdict.json"), join(prog, "data", "review", "verdict.json"))

    const after = contentHashOf(prog)
    assert.equal(
      after,
      booked,
      "the verdict seat must not change the program's identity — the spur's version (src/doors/run.ts:457) is exactly what 'program changed since booking' compares (src/adapters/store.ts:852, bin/whitehartlane:1196); the seat alone moved the hash",
    )

    // the CONSUMER's receipt, on the job the booking would have written
    const job = { spur: { source: prog, content_hash: booked } } as unknown as JobRecord
    const why = failedWakeWhy(job, "failed")
    assert.ok(
      !/program changed since booking/.test(why),
      `the wake must not claim the program changed since booking — only the seat was added: "${why}"`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
