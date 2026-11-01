import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p33-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import {
  abortJob,
  continueJob,
  createJob,
  loadJob,
  openSession,
  pauseJob,
} from "../../src/adapters/store.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one function per decision — the diff's own single-act law) /
// INV-4 (the record must not lie about who leads).
//
// THE LAW, written by this diff into three writers that race a flip:
//   - the probe (run.ts book()): "THE single-act law … re-read the
//     record from disk before orphaning" (loadJob ?? job);
//   - the spawn beat (levy.ts spawnRunner, r20 momentum-11): "save the
//     FRESH record — the door's in-memory copy may be stale …
//     clobbering it with the stale object resurrects the orphan flip
//     into a second live writer" (loadJob ?? job);
//   - the boot stamp (rail.ts openLedger): "the boot-time load is a
//     snapshot; the disk is re-read HERE, at the write".
// The revival ceremony (rebirthRunner) writes the SAME record TWICE:
// spawnRunner's save (fixed, re-reads) and — two lines below, same
// function, same record — continueJob(job, pid), which saves the
// CALLER'S SNAPSHOT and actively ERASES the receipts it find stale:
// `job.pause = undefined; job.abort = undefined; job.orphan =
// undefined; job.finished = undefined; job.state = "running"`.
// The snapshot is minutes old by construction on the revival paths:
// `whl continue` holds the `jobs` row loaded at bin boot, and
// rebirthRunner's retire loop waits up to 30s PER straggler pane
// before the write; `whl refresh` holds it across the WHOLE drain
// (drainDeadline — minutes by design). A flip landing in that window
// — the abort/pause/orphan receipt another actor honestly wrote — is
// clobbered back to "running" with the receipt deleted: the record
// lies about who leads, the exact split-brain the law exists to
// prevent, one writer after the site the law fixed.
//
// The window is scripted, not timed: boot snapshot, THEN the abort,
// THEN the ceremony's continue write — the snapshot→write gap the law
// itself names. On BASE the law does not exist (no probe, no wake, no
// re-read at the spawn beat — levy.ts carries no r20 receipt), so the
// class this repro judges — the law's own incomplete adoption — has
// nothing to judge there (vacuous green).
test("the revival's continue write re-reads the record — the single-act law covers every writer of the ceremony", () => {
  // BASE shape: the single-act law is this diff's own addition —
  // nothing to judge there (the prove gate classifies introduced)
  const levy = readFileSync(join(ROOT, "src", "adapters", "levy.ts"), "utf8")
  if (!levy.includes("r20 momentum-11")) return

  const session = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "principles-33 revive window",
    runDir: true,
  })

  // the parked generation: refresh's drain parked it (ADR 5) — the
  // revival verb loads its snapshot now
  pauseJob(loadJob(session.id, job.id)!, "drain", 0)
  const snapshot = loadJob(session.id, job.id)!
  assert.equal(snapshot.state, "paused", "sanity: the record reads paused when the revival verb loads it")

  // IN THE WINDOW (the drain is minutes; the retire loop is 30s per
  // straggler): the operator aborts — writing the FRESH record, as
  // every other actor must.
  abortJob(loadJob(session.id, job.id)!, "operator aborted during the drain", 0)
  assert.equal(
    loadJob(session.id, job.id)?.state,
    "aborted",
    "sanity: the abort receipt stands on disk before the ceremony's write",
  )

  // the ceremony's tail, exactly as rebirthRunner performs it:
  // spawnRunner's save re-reads the disk (the law); continueJob saves
  // the SNAPSHOT the verb booted with.
  continueJob(snapshot, 424242)

  const after = loadJob(session.id, job.id)!
  assert.equal(
    after.state,
    "aborted",
    `INV-3/INV-4: the revival's continue write must answer to the disk, not to the boot snapshot. ` +
      `The diff's own single-act law — "re-read the record from disk before writing — a concurrent actor may ` +
      `have flipped it between this snapshot and the write" (run.ts book(); levy.ts spawnRunner r20 momentum-11; ` +
      `rail.ts openLedger) — was applied to the ceremony's FIRST write (spawnRunner) and not to its SECOND: ` +
      `continueJob (store.ts) saves the caller's snapshot whole and erases every receipt it finds on it ` +
      `(pause/abort/orphan/finished := undefined, state := "running"). Here the operator's abort landed in the ` +
      `revive window (the drain rebirth holds its snapshot across minutes; continue's retire loop across 30s ` +
      `per pane) and the continue write clobbered it: the record now reads ${after.state} with the abort ` +
      `receipt ${JSON.stringify(after.abort ?? null)} erased and pid ${String(after.pid)} stamped — a revived ` +
      `job beside an abort the operator wrote, on the exact recovery path the orphan/pause wakes prescribe. ` +
      `spawnRunner — the immediately preceding write in the same ceremony — re-reads; continueJob must too ` +
      `(or rebirthRunner must re-read before it), or the law has a fifth writer that never heard it.`,
  )
  assert.ok(
    after.abort !== undefined,
    `INV-4: the abort receipt must survive a raced revival write — the record must keep telling the truth ` +
      `about why the run stopped (got abort=${JSON.stringify(after.abort ?? null)}, state=${after.state})`,
  )

  rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
})
