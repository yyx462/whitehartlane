import assert from "node:assert/strict"
import { appendFileSync, cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum3-"))

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

// INV-4 (claims are honest) — the change's own manual (bin/whitehartlane
// review --help, hard rules, lines 325-327) prescribes the recovery for a
// dead/stalled lens: "re-levy the SAME program dir (whl run <dir>
// --unattended) — the settled fold spares done units; never materialize a
// fresh program to retry". ECONOMICS.md repeats it as a measured lever
// ("Re-levy, never re-materialize … the r6/r8 receipts: ~0.9M input
// re-burned on green lenses").
//
// The machinery cannot deliver it. `whl run` books a FRESH job with a
// FRESH staged run dir every time (store.ts createJob runDir:true →
// jobRunDir(sid, jid); run.ts book → stageRun(source, store)), and the
// settled fold is scoped to that dir (state.ts readCheckpoints filters
// `e.dir !== taskDir`; state.json is legacy-only and is not staged). A
// re-levy's ledger therefore starts EMPTY: every unit — done ones
// included — is unfinished, and the pump re-spawns them all (orchestrator
// pump: unfinished = units.filter(u => !finishedIds.has(u.id))).
//
// This repro books the review twice exactly the way the door does
// (stageRun into a fresh store per booking), settles one unit done in
// run 1, leaves the others stalled (the dead-review shape), re-levies the
// SAME program dir, and asserts the manual's promise: the done unit is
// NOT re-spawned. It fails on HEAD: the re-levy re-runs every unit —
// the exact green-lens burn (r6b/r8b) the rule claims to prevent.
test("a re-levy of the SAME program dir spares done units, as the manual's hard rule promises", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-m3-src-"))
  cpSync(FIXTURE, source, { recursive: true })

  // ── run 1: the first `whl run <program dir>` — book() stages the
  // program into a fresh run dir and runs there
  // the fold scans the store (sessionsRoot) for prior staged runs of
  // the same program — run 1 stages inside it so the scan can find it
  const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-fold", "jobs", "j-fold", "run")
  stageRun(source, r1)
  const one = port()
  const d1 = depsFor(r1, one.port)
  cycle(d1)
  assert.equal(one.spawned.length, 3, "sanity: run 1 spawns all three units")

  // france finishes (done marker + worker output); japan/peru stall —
  // the dead-review shape the hard rule addresses
  appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
  cycle(d1)
  assert.ok(
    readState(r1).done.includes("france"),
    "sanity: france settled done in run 1's ledger",
  )

  // ── the re-levy: `whl run <SAME program dir> --unattended` — book()
  // stages the SAME program into ANOTHER fresh run dir (createJob
  // runDir:true) and runs there
  const r2 = mkdtempSync(join(tmpdir(), "whl-m3-run2-"))
  stageRun(source, r2)
  const two = port()
  const d2 = depsFor(r2, two.port)
  cycle(d2)

  assert.ok(
    !two.spawned.includes("w-france"),
    `INV-4: the manual's hard rule (bin/whitehartlane review --help: "re-levy the SAME program dir … the settled fold spares done units") ` +
      `promises a re-levy does not re-run done units, but the second booking re-spawned [${two.spawned.join(", ")}] — ` +
      `the settled fold is scoped to the staged run dir (readCheckpoints filters e.dir === taskDir), a re-levy stages a fresh dir, ` +
      `so its ledger starts empty and every lens re-runs: the exact green-lens re-burn (ECONOMICS.md's r6b/r8b waste) the rule claims to prevent. ` +
      `run 1 ledger: done=${JSON.stringify(readState(r1).done)}; run 2 ledger: done=${JSON.stringify(readState(r2).done)}`,
  )
})
