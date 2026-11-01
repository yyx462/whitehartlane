// questions-26 (questions lens, Q2/Q3) — THE NEW OUTPUT SEAT MOVES THE
// PROGRAM'S IDENTITY: the twin of the seat the diff fixed.
//
// What this change fixed (src/doors/project.ts:101-135, src/doors/run.ts:
// the verdict seat):
//   "the verdict SEAT is output, never input (questions-20): its presence
//    (a link into the run dir) or absence must not change the program's
//    identity — the fold's 'same program?' judgment cannot flip on a seat"
//   → contentHashOf skips data/review/verdict.json.
//
// What the same change ADDED next to it (templates/pr-review/hooks/merge.sh:
//17-26): a SECOND output in the same shelf — the merge stage's outcome
// marker:
//   local seat="${STAGED_DIR:-$prog}/data/review/merge.json"
//   printf '%s\n' "$payload" >"$seat"
// STAGED_DIR is the staged program dir (src/doors/review.ts:1108 writes
// STAGED_DIR=<the staged dir>), so the marker lands INSIDE the program whose
// content hash the booking recorded.
//
// Nothing excludes it: contentHashOf's skip set knows only the verdict seat
// (project.ts:107). So the moment the merge stage writes its marker, the
// program's hash no longer matches the hash the booking recorded, and
// src/adapters/store.ts's failedWakeWhy says
//   "failed — program changed since booking: `whl continue` re-runs the
//    verdict on the same work"
// — a false statement about a program nobody changed (the same flip the
// settle/re-levy fold reads when it asks "same program?").
//
// The repro: a program dir, the merge stage's marker landing in it, and the
// hash the booking recorded. The marker is OUTPUT — it must not move the
// program's identity.
//
// BASE behaviour: BASE has no outcome marker at all; the assertion below is
// about the verdict-seat law the diff itself wrote (project.ts:101-135), so
// on BASE the same write DOES move the hash → the repro fails on BASE too →
// the diff touches src/doors/project.ts → incomplete-fix.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { contentHashOf } from "../../src/doors/project.ts"

test("questions-26: the merge stage's outcome marker is OUTPUT — it must not move the program's identity", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q26-marker-"))
  const prog = join(tmp, "prog")
  try {
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    writeFileSync(join(prog, "workflow.toml"), "[workflow]\nname = 'x'\n")
    writeFileSync(join(prog, "data", "review", "config.sh"), "REPO='/tmp/x'\n")
    // what the booking recorded (run.ts:461: contentHashOf(dir, [...]))
    const booked = contentHashOf(prog)
    // what the merge stage writes when the chain ends (merge.sh:17-26)
    writeFileSync(
      join(prog, "data", "review", "merge.json"),
      JSON.stringify({ outcome: "accept", head: "a".repeat(40), at: "2026-10-30T00:00:00Z" }) + "\n",
    )
    const after = contentHashOf(prog)
    assert.equal(
      after,
      booked,
      `the merge stage's outcome marker is OUTPUT, never input — it must not change the program's identity (the verdict seat got exactly this treatment: project.ts:101-135). booked=${booked} after=${after}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
