import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m18-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m18-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import { Rail } from "../../src/adapters/rail.ts"
import { benchOrder, cycle, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import type { RunnerResult } from "../../src/doors/runners.ts"

const ok = (): RunnerResult => ({ status: 0, stdout: "" })

// BASE shape: the birth judge is this diff's own addition (benchOrder
// gains the "birth" seat here). No birth seat on BASE → nothing to judge.
if (!benchOrder({ faults: true }).includes("birth")) {
  test("skipped on BASE: the birth judge does not exist there", () => {})
} else {
  // a resolvable agent session for `cwd`, born after `sinceIso`, whose
  // first user message carries the brief's marker — the exact rows
  // resolveOpencode/opencodeFirstUserHas query (the principles-24 harness)
  function seedSession(dir: string, cwd: string, sinceIso: string, marker: string, id: string): void {
    const db = new DatabaseSync(dir)
    db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
    db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
    db.prepare("INSERT INTO session_message VALUES (1, ?, 'user', ?)").run(id, JSON.stringify({ text: `Work dir: ${marker}` }))
    db.close()
  }

  function fixtureUnits(where: string): string {
    // the shared example program, rewritten to two lens-style units
    // where one id is a DASH-PREFIX of the other — the natural
    // wave/generation naming (the ledger itself matches same-unit
    // generations via startsWith(`${name}-`), so dash suffixes are an
    // acknowledged id pattern in this repo)
    cpSync(join(import.meta.dirname, "..", "fixtures", "three-lookups"), where, { recursive: true })
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "m18"`,
        `worker_kind = "opencode"`,
        `slots = 2`,
        "",
        "[[stage]]",
        `id = "lookups"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "api-v2", brief = "second generation of the api unit" },`,
        `  { id = "api", brief = "first api unit" },`,
        `]`,
        "",
      ].join("\n"),
    )
    return where
  }

  test("the birth judge does not mistake another unit's session for this unit's boarding (dash-prefix ids)", () => {
    const runDir = mkdtempSync(join(tmpdir(), "whl-m18-run-"))
    const units = mkdtempSync(join(tmpdir(), "whl-m18-prog-"))
    const v2Dir = join(runDir, "units", "api-v2")
    mkdirSync(v2Dir, { recursive: true })
    const briefPath = join(v2Dir, "brief.md")
    writeFileSync(briefPath, "work here")
    const cwd = runDir
    try {
      const rail = new Rail({
        argvDir: runDir,
        transport: { exec: () => ({ status: 0, stdout: "{}" }) } as never,
        shepRunner: ok,
        herdrRunner: ok,
        log: () => {},
      })
      // api-v2 spawns, boards, and its session is booked on its ledger
      // row — the pane is genuinely BOARDER
      const spawned = rail.spawnWorker("w-api-v2", "opencode", briefPath, cwd)
      assert.equal(spawned, true, "sanity: the api-v2 pane spawns through the fake transport")
      seedSession(DB, cwd, new Date().toISOString(), v2Dir, "ses-a2")
      assert.equal(rail.tryBookSession("w-api-v2"), "ses-a2", "sanity: api-v2's session books")
      assert.equal(rail.bookedSessionOf("api-v2"), "ses-a2", "sanity: api-v2 reads as boarded")

      // THE BUG: api never spawned, never boarded — it has no pane row
      // and no session. The birth judge's spared-path (engine.ts's exact
      // lambda) must answer "not boarded" for it.
      const wrong = rail.bookedSessionOf("api")
      assert.equal(
        wrong,
        undefined,
        `sanity that fails on HEAD: bookedSessionOf("api") returned ${JSON.stringify(wrong)} — ` +
          `api-v2's row (unit "w-api-v2") matches the new "w-api" spelling via ` +
          `startsWith("w-api-"), so ANOTHER unit's session is returned as api's boarding evidence`,
      )

      // end to end: the birth judge through cycle(), with the production
      // lambdas (engine.ts fanOutEngine) bound to the real rail
      fixtureUnits(units)
      let clock = 0
      const spawnedNames: string[] = []
      const retired: string[] = []
      const wakes: { label: string; kind: string; detail: string }[] = []
      const port: ShepPort = {
        setLayout: () => {},
        spawnWorker: (name) => {
          spawnedNames.push(name)
          return true
        },
        paneAlive: () => true,
        workerStatus: () => "unknown",
        reprompt: () => true,
        retire: (name) => retired.push(name),
        retireAll: () => {},
        verify: () => "pane-reap: 0 remaining",
        wake: (label, kind, detail) => wakes.push({ label, kind, detail }),
        tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
      }
      const events: { kind: string; payload: Record<string, unknown> }[] = []
      const deps: CycleDeps = {
        taskDir: units,
        hooks: hooksFromDir(units).hooks,
        shep: port,
        inFlight: new Map(),
        attempts: new Map(),
        slots: 2,
        stallMs: 60_000,
        bornMs: 1000,
        briefGraceMs: 60_000,
        now: () => clock,
        emit: (kind, payload) => events.push({ kind, payload }),
        faults: {
          sessionOf: (unitId) => rail.bookedSessionOf(unitId), // engine.ts verbatim
          rebook: (unitId) => rail.tryBookSession(unitId) ?? undefined, // engine.ts verbatim
          cwdOf: () => "/tmp",
          workerStatus: () => "unknown",
          latestSessionFault: () => null,
          switchSessionModel: () => {},
          promptAgent: () => {},
        },
      }
      cycle(deps) // both units spawn (fake panes — neither really boards)
      assert.deepEqual(spawnedNames.sort(), ["w-api", "w-api-v2"], "sanity: both units spawn")
      clock = 2000
      cycle(deps) // past bornMs: api (never boarded) must be judged dead at birth

      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.ok(
        reborn.includes("api"),
        `INV-4 (the birth judge's own law — "Session existence is the only key"; an unboarded pane is ` +
          `transport class killed at bornMs): the api pane never boarded — no pane row, no session of its ` +
          `own — yet the birth judge spared it, because deps.faults.sessionOf("api") (rail.bookedSessionOf) ` +
          `matched the api-V2 pane's row via the new "w-" + startsWith("w-api-") spelling and returned ` +
          `api-v2's session ${JSON.stringify(rail.bookedSessionOf("api"))} as api's boarding evidence. ` +
          `unit.reborn events: ${JSON.stringify(events.filter((e) => e.kind === "unit.reborn"))}. The ` +
          `never-boarded pane therefore rides the full stall ceiling (the exact j-4a0009 class the birth ` +
          `judge exists to kill) and the fault lane can act on another unit's session.`,
      )
      void retired
      void wakes
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }
  })
}
