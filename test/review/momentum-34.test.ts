import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m34-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m34-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`shep` children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
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
  // a resolvable agent session for `cwd`, whose first user message
  // carries the brief's marker — the exact rows
  // resolveOpencode/opencodeFirstUserHas query (the adopted harness:
  // momentum-17/principles-25)
  let msgSeq = 0
  function seedSession(dir: string, cwd: string, timeCreatedMs: number, marker: string, id: string): void {
    const db = new DatabaseSync(dir)
    db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
    db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, timeCreatedMs)
    msgSeq += 1
    db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text: `Work dir: ${marker}` }))
    db.close()
  }

  function railOn(runDir: string, ledger: null | undefined): Rail {
    return new Rail({
      argvDir: runDir,
      transport: { exec: () => ({ status: 0, stdout: "{}" }) } as never,
      shepRunner: ok,
      herdrRunner: ok,
      host: { inhabit: () => true, usageOf: () => null } as never,
      // ledger: null IS the rail's own documented degraded mode —
      // openLedger's catch path ("Best-effort: a run without a record
      // still runs", rail.ts) — exercised here deterministically via
      // the constructor seam (opts.ledger !== undefined wins).
      ledger: ledger as never,
      log: () => {},
    })
  }

  function port() {
    const spawned: string[] = []
    const retired: string[] = []
    const p: ShepPort = {
      setLayout: () => {},
      spawnWorker: (name) => {
        spawned.push(name)
        return true
      },
      paneAlive: () => true,
      workerStatus: () => "unknown",
      reprompt: () => true,
      retire: (name) => retired.push(String(name)),
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    }
    return { port: p, spawned, retired }
  }

  // ── CONTROL: with the ledger LIVE, the rebook resolves the pane's
  // session from the host store — the harness works end to end.
  test("control: the birth judge's rebook resolves a boarded pane's session (ledger live)", () => {
    const runDir = mkdtempSync(join(tmpdir(), "whl-m34-ctl-"))
    try {
      const rail = railOn(runDir, undefined)
      const briefPath = join(runDir, "units", "france", "brief.md")
      mkdirSync(join(runDir, "units", "france"), { recursive: true })
      writeFileSync(briefPath, "work here")
      const spawned = rail.spawnWorker("w-france", "opencode", briefPath, runDir)
      assert.equal(spawned, true, "sanity: the pane spawns through the fake transport")
      // the agent boards: its session lands in the host store 1ms after
      // the attach stamp — inside every honest resolve window
      const attachAt = Date.now()
      seedSession(DB, runDir, attachAt + 1, join(runDir, "units", "france"), "ses-france")
      assert.equal(
        rail.tryBookSession("france"),
        "ses-france",
        "sanity: the rebook resolves the boarded pane's session from the host store",
      )
      assert.equal(rail.bookedSessionOf("france"), "ses-france", "sanity: the session books onto the pane's row")
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  // ── THE LAW: the birth judge's own doctrine — "Session existence is
  // the only key" (r6: boarded — however quiet — is spared). The judge
  // reads boarding through deps.faults.sessionOf → rail.bookedSessionOf
  // and the one-last-look through rail.tryBookSession. BOTH collapse to
  // "never boarded" when the rail's LEDGER is gone — openLedger's own
  // catch path, the mode the rail documents as survivable ("Best-effort:
  // a run without a record still runs"). bookedSessionOf: `if
  // (!this.ledger) return undefined`. tryBookSession: `const since =
  // this.ledger?.job.panes… ?? new Date().toISOString()` — the fallback
  // starts the resolve window AT NOW, so every session that exists
  // (born before the judge's look) falls outside it: the rebook is
  // structurally dead, not best-effort, even though the host store it
  // reads is perfectly available. Net: an unledgered run — one torn
  // store write — reaches born_ms with every BOARDER reading as
  // never-boarded, and the judge kills the working panes (retire),
  // respawns them, re-kills them, and closes the units "dead at birth"
  // — false verdicts (the agents boarded and worked) from an infra
  // failure, the exact r6 outcome the doctrine forbids.
  test("a boarded pane is not reborn when the whl ledger is unavailable — the session store still answers", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "whl-m34-run-"))
    const units = mkdtempSync(join(tmpdir(), "whl-m34-prog-"))
    try {
      cpSync(join(import.meta.dirname, "..", "fixtures", "three-lookups"), units, { recursive: true })
      const rail = railOn(runDir, null) // the degraded mode, deterministically
      const briefPath = join(runDir, "units", "france", "brief.md")
      mkdirSync(join(runDir, "units", "france"), { recursive: true })
      writeFileSync(briefPath, "work here")
      // the pane spawns through the REAL rail (the production shep) —
      // cwdOf/kindOf book, the ledger attach no-ops (null)
      const spawned = rail.spawnWorker("w-france", "opencode", briefPath, runDir)
      assert.equal(spawned, true, "sanity: the pane spawns through the degraded rail")
      // the agent BOARDS: its session is resolvable in the host store —
      // the exact evidence the judge's doctrine says is the only key
      const attachAt = Date.now()
      seedSession(DB, runDir, attachAt + 1, join(runDir, "units", "france"), "ses-france-b")
      // let the real clock advance past the seed stamp — the judge's
      // look and the since-fallback both read the wall clock
      await new Promise((r) => setTimeout(r, 20))

      // the rebook, faced with a null ledger: adapted at adoption
      // (gate-r19) — the original receipt pinned the DISEASE
      // (tryBookSession === undefined, the since-fallback window
      // starting at NOW). The fix books spawn-time stamps: the
      // degraded-mode rebook must resolve a session that sits
      // resolvable in the host store.
      assert.equal(
        rail.tryBookSession("france"),
        "ses-france-b",
        "the degraded-mode rebook resolves a boarded pane's session (the since window starts at the spawn stamp, not at now)",
      )

      // end to end through the judge: the production lambdas (engine.ts)
      // bound to the degraded rail
      let clock = 0
      const { port: fake } = port()
      const events: { kind: string; payload: Record<string, unknown> }[] = []
      const deps: CycleDeps = {
        taskDir: units,
        hooks: hooksFromDir(units).hooks,
        shep: fake,
        inFlight: new Map(),
        attempts: new Map(),
        slots: 1,
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
      cycle(deps) // spawn france
      clock = 2000
      cycle(deps) // past born_ms: the judge looks

      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.deepEqual(
        reborn,
        [],
        `INV-4/the judge's own r6 doctrine ("boarded — however quiet — is spared; session existence is the ` +
          `only key"): the france pane BOARD — its session ses-france-b sits resolvable in the host store (the ` +
          `control above resolves it from the same DB) — yet the birth judge rebirthed it ` +
          `(unit.reborn units: ${JSON.stringify(reborn)}). The rail's ` +
          `ledger was unavailable — openLedger's own documented catch path ("Best-effort: a run without a ` +
          `record still runs") — and BOTH boarding oracles collapse there: bookedSessionOf returns undefined ` +
          `for every pane when !this.ledger, and tryBookSession's since-fallback (\`?? new Date().toISOString()\`) ` +
          `starts the resolve window AT NOW so the existing session falls outside it. At born_ms the judge kills ` +
          `the working pane, respawns it, re-kills it, and closes the unit "dead at birth" — a false verdict ` +
          `written by an infra failure (the whl store's own degraded mode, which the rail promises is ` +
          `survivable). The rebook must resolve from the host store in the degraded mode too (the ledger only ` +
          `carries the pane's born stamp — a spawn-time since does the same job), or the judge must stand down ` +
          `when boarding cannot be observed.`,
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }
  })
}
