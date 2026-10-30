import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-t601-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-t601-db-")), "opencode.db")
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

// the exact rows resolveOpencode/opencodeFirstUserHas query — this
// session's first user message carries NO marker (not committed with
// the brief dir, or not the pane's own message at all)
let msgSeq = 0
function seedSession(dir: string, cwd: string, sinceIso: string, id: string, text: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
  msgSeq += 1
  db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text }))
  db.close()
}

// BASE shape: resolveMarkedSession is this diff's own addition — on BASE
// the late probe was `resolveLiveSession(marker) ?? resolveLiveSession()`
// with no relative arm, so this repro judges the REWRITE (the momentum-14
// device: vacuous on BASE, so the prove gate classifies it introduced).
function readsWithRelArm(): boolean {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "adapters", "rail.ts"), "utf8")
  return src.includes("resolveMarkedSession") && src.includes("relative(cwd, marker)")
}

// INV-3 / INV-4 — the marker doctrine (gate-r9 tests-300's adopted law,
// restated at every booker this diff touched): "a marker in hand means
// the marker is the discriminator; a marker miss means not-committed-yet,
// NEVER the newest sibling's session. The fallback survives only for the
// no-brief shape (nothing to discriminate with)."
//
// resolveMarkedSession's cwd-relative arm breaks that law for the
// FAN-OUT NORM, where the brief lives IN the pane's cwd
// (unitPaths: briefPath = <unitDir>/brief.md, cwd = worktree ?? unitDir —
// marker === cwd). path.relative(cwd, cwd) is "" — the guard
// `rel !== marker` passes ("" !== the absolute marker) and the second
// probe calls resolveLiveSession with expect:"" — which resolveOpencode
// treats as FALSY: `if (expect)` skips the marker check entirely and
// answers newest-wins. The forbidden fallback is back, one spelling later.
//
// The path that breaks: the birth judge's one-last-look (tryBookSession)
// fires when the pane's own first message is not committed yet — the
// exact "not-committed-yet" race the doctrine names. Any newer session
// in the pane's own directory (a sibling generation, the host tool's own
// scratch session) is booked onto this pane's ledger row: the never-
// boarded pane is judged "boarded" and spared (the r6 doctrine breach),
// and a later `whl continue` resumes the WRONG session into the pane
// (ADR-5 cross-booking, j-78ca43).
//
// Deterministic: a real Rail, one spawned pane whose cwd === its marker
// (the fan-out shape), and one markerless session in that cwd born after
// the pane. The doctrine says tryBookSession answers undefined (the
// caller retries); the rel arm answers the markerless session.
test("a marker miss never books a markerless session — the rel arm must not revive newest-wins", () => {
  if (!readsWithRelArm()) return // BASE: no rel arm, nothing to judge
  const runDir = mkdtempSync(join(tmpdir(), "whl-t601-run-"))
  try {
    const rail = railOn(runDir)

    // the fan-out norm: cwd === dirname(briefPath) — the marker IS the cwd
    const cwd = join(runDir, "units", "a")
    const briefPath = join(cwd, "brief.md")
    mkdirSync(cwd, { recursive: true })
    writeFileSync(briefPath, "work here")
    assert.equal(relative(cwd, join(cwd, "brief.md").replace(/\/brief\.md$/, "")), "", "premise: dirname(brief) === cwd — path.relative answers \"\"")
    const spawned = rail.spawnWorker("w-a", "opencode", briefPath, cwd)
    assert.equal(spawned, true, "sanity: the pane spawns through the fake transport")

    // the pane's own session is NOT committed (no markered row). A newer
    // markerless session exists in the pane's cwd — the shape the
    // newest-wins fallback used to cross-book.
    const row = rail.ledger!.job.panes.find((p) => p.unit === "w-a")
    assert.ok(row, "sanity: the pane is on the ledger")
    seedSession(DB, cwd, row!.born, "ses-markerless", "hello world")

    const booked = rail.tryBookSession("a")
    assert.equal(
      booked,
      undefined,
      `INV-3/INV-4 (the marker doctrine, gate-r9 tests-300's adopted law): with a marker in hand a marker ` +
        `miss must answer NOTHING (the caller retries) — never the newest markerless session. Here the pane's ` +
        `cwd === its marker (the fan-out norm: the brief lives in the pane's own unit dir), so ` +
        `resolveMarkedSession's cwd-relative arm computes path.relative(cwd, marker) === "" and probes with ` +
        `expect:"" — falsy in resolveOpencode's \`if (expect)\` — which books NEWEST-WINS: ` +
        `tryBookSession("a") returned ${JSON.stringify(booked)} (ses-markerless), the rel-arm fallback the law ` +
        `says "survives only for the no-brief shape". The never-boarded pane is judged boarded (the birth ` +
        `judge spares it; the r6 breach) and ADR-5 continue resumes a session that is not this pane's. ` +
        `Guard the rel probe on rel !== "" (a relative spelling of "" cannot appear in any first message).`,
    )
    const after = rail.ledger!.job.panes.find((p) => p.unit === "w-a")
    // adapted (gate-r12, adopting lens): the original assertion demanded
    // transcript === undefined, but the write-ahead POINTER {tool, cwd,
    // since} is the documented spawn shape (store.ts: "booked the moment
    // the host tool reports it — write-ahead, so even a SIGKILLed
    // orchestrator leaves a resumable pane") and predates this diff.
    // The DISEASE is the markerless session LANDING — session_id on the
    // pointer — so that is what this pins.
    assert.equal(
      after?.transcript?.session_id,
      undefined,
      "the markerless session must not land on the pane's ledger row (ADR-5 cross-booking)",
    )
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})
