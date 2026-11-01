import assert from "node:assert/strict"
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m31-"))

import { stageRun } from "../../src/doors/run.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { cycle, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { readState } from "../../src/core/state.ts"

// TRACE/MOMENTUM — the re-levy fold's own law (run.ts copyBeside, the
// momentum-4 receipt this diff writes): "folded verdicts must be the
// new run's OWN hooks' verdicts". The fold spares a prior's done units
// on the strength of the done CARD alone: `settled.done.filter((u) =>
// existsSync(units/u))` (run.ts:233) plus the r26 readdirSync probe
// (run.ts:243) for UNREADABLE dirs. An INCOMPLETE done unit — the
// torn-prior shape whose directory exists while the unit's deliverable
// (result.md, the artifact every settle writes and the fixture's grade
// hook demands non-empty) is gone — passes both screens and folds:
// run 2's ledger marks the unit done with no re-grade, no spawn, and
// no deliverable. A re-run of this unit under run 2's own grade hook
// would FAIL it — the card claims a settle the new run's hooks never
// made (INV-4). The manual's own recovery spell (`whl run <same dir>
// --unattended`) is the path that rides this fold. Introduced by this
// diff (the fold is new); on BASE there is no fold.

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

test("the fold does not spare a done card whose unit's own deliverable is gone (torn prior)", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-m31-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  try {
    // ── run 1: france settles done
    const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m31", "jobs", "j-m31", "run")
    stageRun(source, r1)
    const one = port()
    const d1 = depsFor(r1, one.port)
    cycle(d1)
    appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
    writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
    cycle(d1)
    assert.ok(readState(r1).done.includes("france"), "sanity: france settled done in run 1's ledger")

    // ── the torn-prior shape: the deliverable vanishes from the done
    // unit dir (a crash mid-copy, a disk fault, a cleanup hand). The
    // dir exists — the fold's existsSync/readdirSync screens pass.
    unlinkSync(join(r1, "units", "france", "result.md"))

    // ── run 2: the manual's re-levy spell. The fold must not claim a
    // verdict the run's own hooks would refuse: an incomplete unit
    // re-runs (wrong-fresh beats wrong-replay).
    const r2 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m31", "jobs", "j-m31b", "run")
    stageRun(source, r2)
    const two = port()
    const d2 = depsFor(r2, two.port)
    cycle(d2)

    assert.ok(
      !readState(r2).done.includes("france"),
      `INV-4 (a settle is the run's own hooks' verdict, never a carried card): the fold spared run 1's ` +
        `done card for france AFTER france's own deliverable (result.md) was gone from the torn prior — ` +
        `run 2's ledger claims done=${JSON.stringify(readState(r2).done)} with france re-run by ` +
        `[${two.spawned.join(", ") || "NOBODY"}]: no spawn, no re-grade, and the folded unit dir carries ` +
        `no result.md. The fold's own law (run.ts copyBeside, the momentum-4 receipt: "folded verdicts ` +
        `must be the new run's OWN hooks' verdicts") is false for the torn-prior shape the r26 probe ` +
        `fix was written for — the probe screens UNREADABLE dirs and folds INCOMPLETE ones. Under run 2's ` +
        `own grade hook (the fixture's: a non-empty result.md passes) france would FAIL — the card ` +
        `claims a settle the hooks never made. An incomplete done (deliverable missing) must re-run.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})
