import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p24-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-p24-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`git` children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import type { RunnerResult } from "../../src/doors/runners.ts"
import { runFaultLane } from "../../src/engines/fault-lane.ts"

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
function seedSession(dir: string, cwd: string, sinceIso: string, marker: string, id: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
  db.prepare("INSERT INTO session_message VALUES (1, ?, 'user', ?)").run(id, JSON.stringify({ text: `Work dir: ${marker}` }))
  db.close()
}

// INV-3 (one decision, one place — "the ledger key that names a fan-out
// pane's unit") / INV-4 (the diff's own claim is honest).
//
// The diff wires input.faults into cycle() for the FIRST time ("the lane
// has been dead code since it merged") and seats a birth judge whose
// spared-paths are session existence: `deps.faults.sessionOf(b.id)`
// (boarded — however quiet, the r6 doctrine) and `deps.faults.rebook?.(b.id)`
// (one last look). Both read by the BARE unit id. The writers spell the
// same identity differently:
//   - the ledger's unit column: orchestrator claims spawn `w-${unit.id}`
//     (orchestrator.ts resumeSpawn/spawn call), so Rail.spawnWorker →
//     ledger.attach(label, pane, "w-france", …) — the engine's own
//     resume walker re-keys exactly this ("the ledger's unit column
//     carries the transport name (w-<id> for fan-out workers) — re-key
//     here", engine.ts);
//   - the rail's per-pane spawn state (cwdOf/kindOf/briefOf): keyed by
//     scopedName("w-france"), while tryBookSession scopes the bare id it
//     is handed (scopedName("france") — a different label).
// So for EVERY fan-out pane: bookedSessionOf("france") filters
// p.unit === "france" (never matches "w-france") → undefined forever, and
// tryBookSession("france") finds no cwd/kind → undefined forever. The
// fault lane the diff claims to have wired runs `const fault = sid ?
// latestSessionFault(...) : null` → budgetAction({fault:false}) →
// { kind: "none" } (model-ladder.ts) — the lane is STILL dead for every
// fan-out worker, and the birth judge's r6 check ("boarded — however
// quiet") is unreachable: both session spared-paths are dead letters.
//
// Deterministic: a real Rail (self-opened ledger), a spawned pane, a
// session resolvable in a crafted OPENCODE_DB. Sanity first: addressed
// by the WRITER's spelling both readers work — only the twin spelling
// fails. On BASE the seam is dead code (input.faults dropped), so the
// mismatch harms nothing there; the wiring is what this diff adds.
test("the fault lane's and birth judge's session lookups match the ledger's own unit spelling", () => {
  const runDir = mkdtempSync(join(tmpdir(), "whl-p24-run-"))
  const unitDir = join(runDir, "units", "france")
  mkdirSync(unitDir, { recursive: true })
  const briefPath = join(unitDir, "brief.md")
  writeFileSync(briefPath, "work here")
  const cwd = runDir
  try {
    const rail = railOn(runDir)
    // BASE shape: the rebook seam (rail.tryBookSession) is this diff's
    // own addition — on BASE the faults object is built and dropped, no
    // reader runs, and this repro has nothing to judge (green there)
    if (typeof (rail as { tryBookSession?: unknown }).tryBookSession !== "function") return
    // the production claim path, verbatim: orchestrator.ts spawns
    // `w-${unit.id}` (resumeSpawn/spawn), so the rail books the pane
    // under unit "w-france"
    const spawned = rail.spawnWorker("w-france", "opencode", briefPath, cwd)
    assert.equal(spawned, true, "sanity: the pane spawns through the fake transport")

    // the session the agent minted is REAL and resolvable — the rebook
    // speaks the BARE unit id (the birth judge's b.id; gate-r9 — the
    // w- form was the pre-r9 dual-spelling habit)
    seedSession(DB, cwd, new Date().toISOString(), unitDir, "ses-1")
    const booked = rail.tryBookSession("france")
    assert.equal(booked, "ses-1", "sanity: tryBookSession resolves + books the session under the writer's own key")
    const row = rail.ledger!.job.panes.find((p) => p.unit === "w-france")
    assert.ok(row, "sanity: the ledger's pane row carries unit 'w-france' (the writer's spelling)")
    assert.equal(row?.transcript?.session_id, "ses-1", "sanity: the pane's session id is BOOKED on the row")

    // ① the fault lane's + birth judge's sessionOf — engine.ts's exact
    // lambda body: sessionOf: (unitId) => rail.bookedSessionOf(unitId)
    const seenByLane = rail.bookedSessionOf("france")
    assert.equal(
      seenByLane,
      "ses-1",
      `INV-3: "which ledger row is this unit's pane" is written one way and read another. The writer spells ` +
        `the fan-out pane's unit "${row?.unit}" (orchestrator spawns w-\${unit.id}; Rail.spawnWorker attaches it ` +
        `verbatim), but every reader this diff wired spells it bare: faults.sessionOf = (unitId) => ` +
        `rail.bookedSessionOf(unitId) (engine.ts) filters p.unit === "france" and never matches. The pane's ` +
        `session ${row?.transcript?.session_id} is booked on the row, yet bookedSessionOf("france") returns ` +
        `${JSON.stringify(seenByLane)} — so the just-wired provider-fault lane computes fault = null for every ` +
        `unit (budgetAction({fault:false}) → "none") and the birth judge's r6 spared-path ("boarded — however ` +
        `quiet") is unreachable. The diff's claim — the lane "has been dead code … [now] forwarded" — is false: ` +
        `it is forwarded into a key that matches nothing. One decision, two spellings; on BASE the seam was ` +
        `dropped before any reader ran, so the mismatch harms nothing there — the wiring introduces the harm.`,
    )


    // ② the birth judge's rebook — engine.ts: rebook = (unitId) =>
    // rail.tryBookSession(unitId) — the rail's spawn state (cwdOf/kindOf)
    // is keyed scopedName("w-france"); tryBookSession scopes the bare
    // id it is handed and finds nothing
    const rebooked = rail.tryBookSession("france")
    assert.equal(
      rebooked,
      "ses-1",
      `INV-3: the same twin spelling breaks the birth judge's second look: rebook(b.id) hands tryBookSession ` +
        `the bare unit id, but cwdOf/kindOf were set under scopedName("w-france") at spawn — the scoped lookup ` +
        `"france" finds no cwd and tryBookSession returns ${JSON.stringify(rebooked)} WITHOUT consulting the ` +
        `session store (tryBookSession("w-france") on the same rail returns "ses-1"). The judge's own contract — ` +
        `"one IMMEDIATE re-resolve before it is judged dead at birth" — never fires for any fan-out pane.`,
    )

    // ③ the consumed consequence: the fault lane, driven with the
    // engine's EXACT wiring, cannot see a provider fault that its own
    // scripted rail reports for the booked session — while the same
    // lane with the writer's spelling acts. Differential, same lane,
    // same fault, only the key differs.
    const prompts: string[] = []
    const switches: string[] = []
    const laneRail = {
      workerStatus: () => "idle",
      latestSessionFault: (sid: string, _cwd: string) => ({ id: "f-1", type: "over_budget" }),
      switchSessionModel: (sid: string, to: string, _cwd: string) => {
        switches.push(`${sid}->${to}`)
        return { ok: true }
      },
      promptAgent: (name: string, text: string) => {
        prompts.push(name)
        return true
      },
    }
    const base = {
      taskDir: runDir,
      names: ["france"],
      cwdOf: () => cwd,
      modelOf: () => "acme/b",
      setModel: () => {},
      isDead: () => false,
      awaitingTurn: new Set<string>(),
      actedFault: new Map<string, string>(),
      deadModels: new Map<string, Set<string>>(),
      policy: { mode: "auto" as const, order: ["acme/b", "acme/c"] },
      rail: laneRail,
      close: () => {},
      resetClock: () => {},
      log: () => {},
    }
    // the engine's wiring, verbatim body (engine.ts faults literal).
    // Under THE FIXED rail both spellings resolve (gate-r4: the
    // dual-spelled lookup), so the lane ACTS — the stated purpose
    // ("the jev ladder reaches fan-out workers too", j-93d652 gap #4)
    // is delivered through the engine's own wiring, not only the
    // writer's spelling (the ①-pin expected the disease: 0 prompts).
    runFaultLane({ ...base, sessionOf: (id) => rail.bookedSessionOf(id) })
    assert.equal(
      prompts.length,
      1,
      `INV-4/INV-3: with the engine's exact wiring the lane must reach the ladder — a faulting fan-out worker gets prompted (got prompts=${JSON.stringify(prompts)}, switches=${JSON.stringify(switches)})`,
    )
    assert.equal(
      switches.length,
      1,
      `the ladder switches the faulting worker's session model (got switches=${JSON.stringify(switches)})`,
    )
    // control: the SAME lane with the WRITER's spelling acts identically
    const prompts2: string[] = []
    const switches2: string[] = []
    const laneRail2 = { ...laneRail, promptAgent: (name: string) => { prompts2.push(name); return true }, switchSessionModel: (sid: string, to: string) => { switches2.push(`${sid}->${to}`); return { ok: true } } }
    runFaultLane({ ...base, rail: laneRail2, sessionOf: (id) => rail.bookedSessionOf(`w-${id}`) })
    assert.deepEqual(
      prompts2.length && switches2.length ? switches2 : switches,
      ["ses-1->acme/c"],
      `sanity: the lane itself is healthy — BOTH spellings act identically under the fixed rail (writer-spelling prompts=${JSON.stringify(prompts2)})`,
    )
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})
