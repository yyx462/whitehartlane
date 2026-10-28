import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-t300-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-t300-db-")), "opencode.db")
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
    log: () => {},
  })
}

// a resolvable agent session for `cwd`, born after `sinceIso`, whose
// first user message carries the brief's marker — the exact rows
// resolveOpencode/opencodeFirstUserHas query (session_v2 + session_message)
let msgSeq = 0
function seedSession(dir: string, cwd: string, sinceIso: string, marker: string, id: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
  msgSeq += 1
  db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text: `Work dir: ${marker}` }))
  db.close()
}

// Meta-ACH: duplicate identity — the momentum-18 class, one spelling
// later. bookedSessionOf's exact-match fix killed the SUFFIX collision
// (api vs api-v2) by answering both spellings {name, `w-${name}`}, but
// the dual spelling re-opens a PREFIX collision the moment an author
// picks a unit id that already carries the transport prefix: unit
// "w-api" is a legal SHEP_SAFE_ID, spawns as "w-w-api", and now
// bookedSessionOf("w-api") matches BOTH units' ledger rows:
//   - unit "api"'s pane row carries unit "w-api" (the spawn spelling)
//   - unit "w-api"'s pane row carries unit "w-w-api"
// newest-born-wins then hands the fault lane and the birth judge the
// WRONG unit's session whenever the w-prefixed unit's pane was born
// first — a never-boarded pane judged "boarded" (the r6 doctrine
// breach momentum-18 pinned) and a fault ladder aimed at another
// unit's session. tryBookSession has the same twin: bare
// scopedName("w-api") hits the API pane's kindOf/cwdOf rows.
// Deterministic: a real Rail, two spawned panes sharing one cwd (the
// worktree shape), both sessions seeded in a crafted OPENCODE_DB.
test("a unit id carrying the w- prefix gets its OWN session, never a dash-prefix sibling's", () => {
  const runDir = mkdtempSync(join(tmpdir(), "whl-t300-run-"))
  try {
    const rail = railOn(runDir)
    // BASE/HEAD shape guard: the dual-spelled lookup is this diff's own
    // addition — on BASE the single-spelling lookup had the same hole,
    // so this repro judges the REWRITE, not the old code
    if (!readsWithW()) return

    const cwd = runDir // siblings share the cwd (worktree shape) — the marker keeps bookings straight
    // sessions are seeded BEFORE each spawn (time_created = seed + 5s,
    // always after the spawn's since pointer) so the attach-time resolve
    // books them — the production healthy-boarding shape
    // unit "w-api" spawns FIRST (its pane is born first — the ordering
    // that breaks newest-born-wins across the colliding spellings)
    const briefW = join(runDir, "units", "w-api", "brief.md")
    mkdirSync(join(runDir, "units", "w-api"), { recursive: true })
    writeFileSync(briefW, "work here")
    seedSession(DB, cwd, new Date().toISOString(), join("units", "w-api"), "ses-wapi")
    const spawnedW = rail.spawnWorker("w-w-api", "opencode", briefW, cwd)
    assert.equal(spawnedW, true, "sanity: the w-api pane spawns through the fake transport")

    // unit "api" spawns SECOND (born last — newest in the ledger)
    const briefA = join(runDir, "units", "api", "brief.md")
    mkdirSync(join(runDir, "units", "api"), { recursive: true })
    writeFileSync(briefA, "work here")
    seedSession(DB, cwd, new Date().toISOString(), join("units", "api"), "ses-api")
    const spawnedA = rail.spawnWorker("w-api", "opencode", briefA, cwd)
    assert.equal(spawnedA, true, "sanity: the api pane spawns through the fake transport")

    // book both panes' OWN sessions on the ledger (the healthy-boarded
    // shape: each agent boarded, each late probe booked its own row)
    const rowA = rail.ledger!.job.panes.find((p) => p.unit === "w-api")
    const rowW = rail.ledger!.job.panes.find((p) => p.unit === "w-w-api")
    assert.ok(rowA && rowW, "sanity: both panes are on the ledger")
    rail.ledger!.setSession(rowA!.label, "ses-api")
    rail.ledger!.setSession(rowW!.label, "ses-wapi")

    // the ledger carries both rows under their spawn spellings
    const rows = rail.ledger!.job.panes.filter((p) => p.transcript)
    assert.deepEqual(
      [...rows.map((r) => r.unit)].sort(),
      ["w-api", "w-w-api"],
      "sanity: both panes booked under their spawn spellings (w-<unit.id>)",
    )

    // control: the bare-id lookup answers api's OWN session
    assert.equal(rail.bookedSessionOf("api"), "ses-api", "sanity: unit api reads its own session")

    // the fault: unit "w-api" must read its OWN session
    assert.equal(
      rail.bookedSessionOf("w-api"),
      "ses-wapi",
      `INV-3 (one identity, one answer — the momentum-18 class, one spelling later): bookedSessionOf's ` +
        `dual spelling {name, "w-" + name} makes unit "w-api"'s lookup match BOTH ledger rows — unit "api"'s ` +
        `pane (unit "w-api") and unit "w-api"'s pane (unit "w-w-api") — and newest-born-wins returns the ` +
        `other unit's session ("ses-api") because api's pane was born last. The fault lane then ladders on a ` +
        `session that is not this unit's, and the birth judge's spared-path reads a never-boarded "w-api" pane ` +
        `as boarded (the r6 doctrine breach momentum-18 pinned for the suffix shape). SHEP_SAFE_ID legalizes ` +
        `the id "w-api"; the strip and intake accept it; only this lookup cannot tell the two units apart.`,
    )

    // the same collision through the birth judge's rebook
    assert.equal(
      rail.tryBookSession("w-api"),
      "ses-wapi",
      `INV-3: tryBookSession("w-api") resolves bare scopedName("w-api") FIRST — which is unit "api"'s pane ` +
        `kindOf/cwdOf row — so the rebook answers api's marker/session ("ses-api") for unit "w-api" and books ` +
        `it onto api's ledger row. The birth judge's "one IMMEDIATE re-resolve" must answer the pane it was ` +
        `asked about, not a dash-prefix sibling's.`,
    )
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})

function readsWithW(): boolean {
  // the dual spelling is the diff's own rewrite — detect it in source
  const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "adapters", "rail.ts"), "utf8")
  return src.includes("w-${name}")
}
