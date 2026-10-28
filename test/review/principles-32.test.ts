import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p32-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-p32-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`shep`/`git` children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import type { RunnerResult } from "../../src/doors/runners.ts"

const ok = (): RunnerResult => ({ status: 0, stdout: "" })

let msgSeq = 0
// a resolvable agent session for `cwd`, born after `sinceIso`, whose
// first user message carries the marker — the exact rows
// resolveOpencode/opencodeFirstUserHas query (the principles-24 harness)
function seedSession(dir: string, cwd: string, sinceIso: string, marker: string, id: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
  msgSeq += 1
  db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text: `Work dir: ${marker}` }))
  db.close()
}

// INV-3 (one decision, one place — "when a marked pane's resolve finds
// nothing, may the NEWEST sibling's session book onto its row?").
// This diff wrote the law at TWO bookers and left the third holding the
// old answer:
//   - rail.tryBookSession (the birth judge's rebook) — "when a MARKER
//     exists, it is the discriminator — resolveOpencode's own doctrine
//     (no candidate carries the marker → NO id; the caller retries)
//     forbids the marker-less newest-wins fallback, which cross-booked
//     a dash-prefix sibling's session onto this pane's row. The
//     fallback survives only for the no-brief shape."
//   - rail.bookSessionLate — the same doctrine, same diff.
//   - rail.inhabitPane's +5s late probe (rail.ts:662) — the booker
//     every fleet pane and every coworker member births through —
//     still runs `resolveLiveSession(marker) ??
//     resolveLiveSession()` WITH a marker in hand: the exact fallback
//     the law forbids.
// The consequence lands on this diff's own new consumer: the birth
// judge spares a pane because `deps.faults.sessionOf(b.id)` says
// "boarded — however quiet" — and the sibling's cross-booked session
// satisfies that key for a pane that NEVER boarded. The dead-at-birth
// kill (the j-4a0009 class born_ms exists to cut) is defeated for
// shared-cwd panes, and the fault lane can act on another unit's
// session — the momentum-18/tests-300 receipt class, one layer down
// from where gate-r9 fixed it. Deterministic: a fake host births two
// panes sharing one cwd; the sibling's session (marker "c") lands
// after both birth stamps; unit "a" never boards. The control pane
// "c" books its own session through the SAME probe (the harness
// works); pane "a" must book nothing.
test("the marker doctrine reaches every booker — a shared-cwd sibling's session never books onto a marked pane", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "whl-p32-run-"))
  const sets: [string, string][] = []
  try {
    for (const unit of ["a", "c"]) {
      mkdirSync(join(runDir, "units", unit), { recursive: true })
      writeFileSync(join(runDir, "units", unit, "brief.md"), `work here (${unit})`)
    }
    const rail = new Rail({
      argvDir: runDir,
      transport: { exec: () => ({ status: 0, stdout: "{}" }) } as never,
      shepRunner: ok,
      herdrRunner: ok,
      host: { inhabit: () => true } as never,
      ledger: {
        job: { panes: [] },
        attach: () => {},
        setSession: (label: string, sid: string) => sets.push([label, sid]),
        emit: () => {},
      } as never,
      log: () => {},
    })
    // BASE shape: the marker doctrine (tryBookSession) is this diff's
    // own law — on BASE there is no law, nothing to judge
    if (typeof (rail as { tryBookSession?: unknown }).tryBookSession !== "function") return

    // both panes birth through the SHARED birth path (inhabitPane —
    // every fleet pane and coworker member spawns here), one shared cwd
    const okC = rail.inhabitPane("w-c", "opencode", "pane-c", join(runDir, "units", "c", "brief.md"), runDir)
    const okA = rail.inhabitPane("w-a", "opencode", "pane-a", join(runDir, "units", "a", "brief.md"), runDir)
    assert.equal(okC && okA, true, "sanity: both panes birth through the fake host")

    // the sibling genuinely boards: unit c's session lands after both
    // birth stamps, in the same cwd, carrying unit c's marker
    seedSession(DB, runDir, new Date().toISOString(), join(runDir, "units", "c"), "ses-c")

    // the +5s late probes fire
    await new Promise((r) => setTimeout(r, 5_800))

    // control: the probe books a pane's OWN session when the marker
    // matches (the harness demonstrably books). Labels are scope-suffixed
    // (scopedName) — match the spawn-name prefix, never the raw equality.
    const owns = (label: string, name: string) => label === name || label.startsWith(`${name}-`)
    const control = sets.find(([l, s]) => s === "ses-c" && owns(l, "w-c"))
    assert.ok(control, `sanity: the marked path books unit c its own session (sets: ${JSON.stringify(sets)})`)

    // THE LAW: pane a never boarded; its marked resolve finds nothing;
    // the newest sibling's session must NOT book onto its row.
    const cross = sets.find(([l, s]) => s === "ses-c" && owns(l, "w-a"))
    assert.equal(
      cross,
      undefined,
      `INV-3: "may the newest sibling's session book onto a marked pane that resolved nothing?" is answered NO by ` +
        `this diff's own law — tryBookSession ("when a MARKER exists, it is the discriminator … the marker-less ` +
        `newest-wins fallback … cross-booked a dash-prefix sibling's session onto this pane's row. The fallback ` +
        `survives only for the no-brief shape") and bookSessionLate (the same doctrine) — and YES by the third ` +
        `booker, inhabitPane's +5s probe (rail.ts:662: resolveLiveSession(kind, cwd, since, marker) ?? ` +
        `resolveLiveSession(kind, cwd, since) WITH a marker in hand), the birth path every fleet pane and coworker ` +
        `member spawns through: it booked sibling session ses-c onto pane w-a (bookings: ${JSON.stringify(sets)}). ` +
        `The consequence rides this diff's own new consumer: the birth judge spares a pane when ` +
        `deps.faults.sessionOf(b.id) answers — "boarded — however quiet" — and a cross-booked sibling session ` +
        `satisfies that key for a pane that NEVER boarded, so the dead-at-birth kill (the j-4a0009 class born_ms ` +
        `exists to cut) is defeated for shared-cwd panes and the fault lane can act on another unit's session ` +
        `(the momentum-18/tests-300 receipt class, one spelling down from where gate-r9 fixed it). One decision, ` +
        `three bookers, two answers: apply the law at inhabitPane's probe too (marked-miss → retry, never the ` +
        `newest sibling).`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})
