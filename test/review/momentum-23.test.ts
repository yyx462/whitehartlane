import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m23-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m23-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`git` children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import type { RunnerResult } from "../../src/doors/runners.ts"

const ok = (): RunnerResult => ({ status: 0, stdout: "" })

function railOn(runDir: string): Rail {
  return new Rail({
    argvDir: runDir,
    transport: { exec: () => ({ status: 0, stdout: "{}" }) } as never,
    shepRunner: ok,
    herdrRunner: ok,
    // the fleet-tab path births panes through host.inhabit — fake it so
    // the REAL inhabitPane body (the code under judgment) runs whole
    host: { inhabit: () => true, usageOf: () => null } as never,
    log: () => {},
  })
}

// the rows resolveOpencode/opencodeFirstUserHas query (session_v2 +
// session_message). `withMessage: false` is the j-eafc83 race shape:
// the session row is committed but the pane's FIRST USER MESSAGE is
// not yet — the exact window this diff's own doctrine names ("a
// marker miss at birth means the brief was not committed yet, not
// that the newest sibling is ours").
let msgSeq = 0
function seedSession(dir: string, cwd: string, bornInMs: number, marker: string | null, id: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, bornInMs)
  if (marker !== null) {
    msgSeq += 1
    db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text: `Work dir: ${marker}` }))
  }
  db.close()
}

// MOMENTUM (a settle that assumes / an ordering that only holds on the
// happy path) + INV-3 (one decision, one place):
//
// "when this pane's marker-resolve misses at the +5s late probe, may
// the probe book the newest sibling's session?" is answered THREE
// ways in src/adapters/rail.ts after this diff:
//   - inhabitPane's +5s timer (the FAN-OUT birth booking probe — the
//     review rail's own lens panes book here): marker first, then the
//     newest-wins FALLBACK — untouched by the diff;
//   - bookSessionLate (the coworker member probe): the diff REMOVED
//     the fallback — "a null marker-resolve means 'not resolvable
//     yet' (the message race resolveOpencode documents) — the
//     marker-less newest-wins fallback cross-booked siblings sharing
//     a cwd";
//   - tryBookSession (the birth judge's rebook, the diff's new
//     probe): strict marker-only — "The fallback survives only for
//     the no-brief shape (nothing to discriminate with)".
// That last claim is FALSE repo-wide: the brief-bearing shape's
// fallback is alive exactly where the review rail books its lenses.
// The panes share ONE cwd on the normal review path (deps.worktree —
// the program's tree — is passed as every unit's spawn cwd), so the
// ordering the fallback assumes (newest session in cwd == mine) only
// holds when every sibling's first message commits before the probe.
// The happy path is seconds; the race window is the doctrine's own
// subject (j-eafc83: siblings born seconds apart race message
// persistence). Deterministic here: alpha's session row is committed,
// its first message is NOT; beta is born last with its message
// committed. Alpha's +5s probe must answer "not resolvable yet"
// (the birth judge's strict rebook retries at born_ms) — instead the
// fallback books BETA's session onto alpha's ledger row: the ADR-5
// continue then resumes another unit's conversation, and the fault
// lane ladders a model switch on a session that is not this unit's.
test("a fan-out pane's late booking never lands on a sibling's session, however late its first message commits", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "whl-m23-run-"))
  try {
    const rail = railOn(runDir)

    // the shared-cwd shape (the review rail's normal: every lens pane
    // spawns with deps.worktree — the program's tree — as its cwd)
    const cwd = runDir

    // unit "alpha" births FIRST through the fleet-tab body (the
    // production review layout — momentum-17's receipt: the pr-review
    // orchestrator.log shows every lens spawned in fleet tab panes);
    // its session is committed with NO first user message (the
    // persistence race, mid-window)
    const briefAlpha = join(runDir, "units", "alpha", "brief.md")
    mkdirSync(join(runDir, "units", "alpha"), { recursive: true })
    writeFileSync(briefAlpha, "work here\n")
    seedSession(DB, cwd, Date.now() + 1_500, null, "ses-alpha")
    assert.equal(
      rail.inhabitPane("w-alpha", "opencode", "pane-a", briefAlpha, cwd),
      true,
      "sanity: alpha's pane births through the real inhabitPane body",
    )

    // unit "beta" births SECOND (born last — newest in the shared cwd),
    // its first message COMMITTED (the healthy sibling)
    const briefBeta = join(runDir, "units", "beta", "brief.md")
    mkdirSync(join(runDir, "units", "beta"), { recursive: true })
    writeFileSync(briefBeta, "work here\n")
    seedSession(DB, cwd, Date.now() + 3_500, join(cwd, "units", "beta"), "ses-beta")
    assert.equal(
      rail.inhabitPane("w-beta", "opencode", "pane-b", briefBeta, cwd),
      true,
      "sanity: beta's pane births through the real inhabitPane body",
    )

    const rowAlpha = rail.ledger!.job.panes.find((p) => p.unit === "w-alpha")
    const rowBeta = rail.ledger!.job.panes.find((p) => p.unit === "w-beta")
    assert.ok(rowAlpha && rowBeta, "sanity: both panes are on the ledger")

    // the attach-time resolve is strict (marker only) and alpha's
    // message is uncommitted — nothing books at birth
    assert.equal(
      rowAlpha!.transcript?.session_id,
      undefined,
      "sanity: alpha's marker-resolve misses at birth (the message is uncommitted) — nothing booked yet",
    )

    // wait out the +5s late probe (inhabitPane's unref'd timer)
    await new Promise((r) => setTimeout(r, 5_800))

    const booked = rail.bookedSessionOf("alpha")
    assert.notEqual(
      booked,
      "ses-beta",
      `INV-3/INV-4 (one decision, one place; the change's own claim is false): "may a marker-miss booking ` +
        `fall back to newest-wins?" is answered YES by inhabitPane's +5s probe (the fan-out path the review ` +
        `rail's lenses book through — untouched by this diff) and NO by the diff's own twin probes ` +
        `(bookSessionLate: "the marker-less newest-wins fallback cross-booked siblings sharing a cwd"; ` +
        `tryBookSession: "the fallback survives only for the no-brief shape"). The claim is false: the ` +
        `brief-bearing fallback is alive exactly where the lenses book. With the panes sharing ONE cwd ` +
        `(deps.worktree — the review rail's normal shape) and alpha's first message uncommitted at probe ` +
        `time, alpha's row booked ses-beta (a sibling's session): an ADR-5 continue then resumes another ` +
        `unit's conversation, the fault lane ladders another unit's session, and the birth judge's strict ` +
        `rebook contradicts the booking its own rail made 4½ minutes earlier. The doctrine's own answer: ` +
        `a marker miss is "not resolvable yet" — no id, the later strict probe retries. ` +
        `got: ${String(booked)}`,
    )
    // and the strict twin must agree — the rebook never answers the sibling
    // either (the rebook is the diff's own addition; BASE has none)
    if (typeof (rail as { tryBookSession?: unknown }).tryBookSession === "function") {
      assert.notEqual(
        rail.tryBookSession("alpha"),
        "ses-beta",
        "INV-3: the birth judge's rebook (strict) and the +5s probe (fallback) answer the same question with opposite books",
      )
    }
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})
