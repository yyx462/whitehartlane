import assert from "node:assert/strict"
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum6-"))

import { stageRun } from "../../src/doors/run.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { cycle, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { readState } from "../../src/core/state.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

function port() {
  const spawned: string[] = []
  const p: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name) => {
      spawned.push(name)
      return true
    },
    paneAlive: () => true,
    workerStatus: () => "unknown",
    reprompt: () => true,
    retire: () => {},
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port: p, spawned }
}

function depsFor(dir: string, shep: ShepPort): CycleDeps {
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    log: () => {},
  }
}

// INV-3/INV-4 — the fold's "is this prior COMPLETED?" decision
// (src/doors/run.ts copyBeside: `total = existsSync(units.jsonl) ? line
// count : settled.done.length + settled.failed.length`) answers the
// fallback with the settled count itself — so a prior carrying ANY
// settled card but NO units.jsonl is declared completed.
//
// A prior with settled cards and no units.jsonl is not a completed run:
// any run that settles its OWN unit first writes the units snapshot
// (acquireUnits → loadUnitsFor writes units.jsonl before the first
// spawn). Cards without a snapshot are the FOLD's own cards — the one
// shape that is provably UNFINISHED. Reachable path (the manual's own
// recovery loop, run twice): run 1 dies mid-lenses (the dead-review
// shape); re-levy #1 stages run 2, folds the done unit, then dies
// BEFORE its pump (the r8 dead-at-birth class, ECONOMICS.md proposal 3:
// spawnRunner fails / the boot crashes / intake faults — the job staged,
// the runner never reached acquireUnits). Re-levy #2 stages run 3: the
// newest prior is run 2, whose ledger says {done: [france]} with no
// units.jsonl → total = 1, settledCount = 1 → "completed — fresh minds,
// nothing folded" → run 3 re-runs EVERY unit. The settled fold does not
// spare done units on the manual's own spell, run twice: the green lens
// re-burns (the r6b/r8b waste the rule claims to prevent).
test("the fold spares done units across a CHAIN of re-levies, not just one", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-m6-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  try {
    // ── run 1: the first `whl run <program dir>` — dies mid-lenses
    const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m6", "jobs", "j-m6", "run")
    stageRun(source, r1)
    const one = port()
    const d1 = depsFor(r1, one.port)
    cycle(d1)
    assert.equal(one.spawned.length, 3, "sanity: run 1 spawns all three units")

    // france finishes; japan/peru stall — the dead-review shape
    appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
    writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
    cycle(d1)
    assert.ok(
      readState(r1).done.includes("france"),
      "sanity: france settled done in run 1's ledger",
    )

    // ── re-levy #1: run 2 stages, the fold spares france, then the
    // runner dies BEFORE its pump (no cycle → no units.jsonl in run 2;
    // the r8 dead-at-birth class). The folded card IS run 2's ledger.
    // Runs stage under the sessions root — that is where every real
    // booking lands (createJob runDir:true), and the only place the
    // fold's prior-scan looks.
    const r2 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m6", "jobs", "j-m6b", "run")
    stageRun(source, r2)
    assert.ok(
      readState(r2).done.includes("france"),
      "sanity: re-levy #1 folded france (the fold works one level deep)",
    )

    // ── re-levy #2: run 3 stages. The manual's hard rule promises the
    // settled fold spares done units on EVERY re-levy of the SAME
    // program dir — run 3 must fold france from run 2's ledger.
    const r3 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m6", "jobs", "j-m6c", "run")
    stageRun(source, r3)
    const three = port()
    const d3 = depsFor(r3, three.port)
    cycle(d3)

    assert.ok(
      !three.spawned.includes("w-france"),
      `INV-3/INV-4: the fold's completed-test (run.ts copyBeside) counts a prior with settled cards ` +
        `but NO units.jsonl as completed (total falls back to settled.done+failed = the settled count itself), ` +
        `so re-levy #2 folded NOTHING and re-spawned [${three.spawned.join(", ")}] — ` +
        `the prior (run 2) was the fold's OWN output: folded cards, no pump, no snapshot, provably unfinished. ` +
        `The manual's hard rule ("re-levy the SAME program dir — the settled fold spares done units") is false ` +
        `on the second re-levy, and the green lens re-burns. ` +
        `run 1 ledger: done=${JSON.stringify(readState(r1).done)}; run 2 ledger: done=${JSON.stringify(readState(r2).done)}; ` +
        `run 3 ledger: done=${JSON.stringify(readState(r3).done)}`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m6"), { recursive: true, force: true })
  }
})
