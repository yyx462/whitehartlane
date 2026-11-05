// momentum-4102 — a unit the DEADLINE CLIFF settles must still record its cost.
//
// The diff adds the per-unit cost row to ONE of the two finish
// ceremonies in the orchestrator:
//
//   src/engines/orchestrator.ts finish()   (the fan-out close)
//       deps.emit?.("unit.finished", ...)
//       deps.emit?.("unit.tokens", { unit: id, ...usage })      <-- the new row
//
//   src/core/orchestrator-chain.ts stepRecorder()  (the chain ceremony)
//       emit("unit.finished", { unit: id, pass, result })      <-- no cost row
//
// The deadline sweep settles the fan-out's IN-FLIGHT units through the
// CHAIN ceremony (src/engines/orchestrator.ts, the deadline arm):
//
//     for (const [id] of [...inFlight]) {
//       record(id, "deadline", false, "deadline")   // the chain's recorder
//       input.shep.retire(`w-${id}`)
//       inFlight.delete(id)
//     }
//
// So the units that were still WORKING when the cliff hit — the burned
// rounds, the ones the economics table exists to price (ECONOMICS.md:
// "† = burned rounds: no verdict for the spend") — emit a
// unit.finished event and NO unit.tokens row. The board's tok column
// then reports a run's spend with the most expensive units missing
// from it, and the assertion "every unit finish emits a unit.tokens
// event" is false on a path every run with a deadline can take.
//
// The seam IS available at that point (the run forwards input.usageOf
// to every cycle), so the cost is knowable where it is dropped.
//
// If the deadline arm settled through the fan-out's finish() — or the
// chain's ceremony also emitted the cost row — this test PASSES.
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the settle card rides the OS-disk trace — keep the operator's home out
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-mom4102-home-"))

const { hooksFromDir } = await import("../src/doors/hooks.ts")
const { runOrchestrator } = await import("../src/engines/orchestrator.ts")
import type { ShepPort } from "../src/engines/orchestrator.ts"

const ROOT = join(import.meta.dirname, "..")

function fakeShep() {
  const retired: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    // the worker is still working — it never writes its done marker
    workerStatus: () => "working",
    reprompt: () => true,
    retire: (name) => retired.push(name),
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, retired }
}

test("a unit settled by the deadline cliff still records its cost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-mom4102-"))
  cpSync(join(ROOT, "test", "fixtures", "three-lookups"), dir, { recursive: true })
  writeFileSync(
    join(dir, "units.jsonl"),
    `${JSON.stringify({ id: "demo", brief: "Produce the deliverable named in the closing contract." })}\n`,
  )
  const events: { kind: string; payload: Record<string, unknown> }[] = []
  const shep = fakeShep()
  // the clock advances on every read — the cliff fires on the first tick
  let clock = 1_000_000
  const now = () => (clock += 1000)

  await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    hooks: hooksFromDir(dir).hooks,
    deadlineMs: 0,
    now,
    trapSignals: false,
    log: () => {},
    emit: (kind, payload) => events.push({ kind, payload }),
    // the seam the run forwards to every cycle — the cost is knowable
    usageOf: () => ({ input: 100_000, output: 10_000, cacheRead: 0, cost: 0, sessions: 1 }),
  })

  const finished = events.filter((e) => e.kind === "unit.finished" && e.payload.unit === "demo")
  const tokens = events.filter((e) => e.kind === "unit.tokens" && e.payload.unit === "demo")
  assert.equal(finished.length, 1, `the cliff settled the in-flight unit — events: ${JSON.stringify(events.map((e) => e.kind))}`)
  assert.equal(
    tokens.length,
    1,
    "the settled unit's cost reached the trace — the deadline arm settles through the chain's ceremony, which emits no cost row",
  )
  assert.deepEqual(shep.retired, ["w-demo"], "the cliff retired the unit's pane")
})
