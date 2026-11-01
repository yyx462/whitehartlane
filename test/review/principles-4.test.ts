import assert from "node:assert/strict"
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p4-"))

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

// INV-3 (twin paths — "is this booking a RE-LEVY of the same program?").
// The diff answers that question by CONTENT identity (run.ts copyBeside:
// sha1 of workflow.toml + data/ + members/). The repo's own law answers
// it by PROGRAM-DIR identity: skills/yyx-whl/SKILL.md's hard rule —
// "re-levy the SAME program dir … never materialize a FRESH program to
// retry" — exists precisely because a fresh materialization is a
// DIFFERENT act from a re-levy. The drill depends on that distinction:
// test/e2e/pr-review/run-drill.sh reuses its fixture repos (fixtures.sh:
// `if [ ! -d "$root/c1" ]`) and its --out dirs across runs, so every
// drill after the first re-materializes byte-identical content —
// config.sh pins the same SHAs — and its header promises "five
// real-agent runs … asserting each VERDICT".
//
// Under a content-keyed fold those two acts are indistinguishable: the
// drill's second run folds run 1's done lens units and spawns NOTHING —
// the drill replays run 1's verdicts forever, and the rail's own
// regression harness (c2-twin, the run-#17 INV-1 class) stops testing.
// Same for any re-review of an unchanged diff with a fresh --out: the
// template promises "4 fresh minds … fresh context is the whole point";
// a content-keyed fold cannot deliver fresh minds.
//
// This repro books run 1, settles one unit done, then re-materializes
// the program byte-identically (exactly what the door's replace-guard
// path + persistent drill root produce) and books run 2. A fresh review
// must run its own units; it fails on HEAD because run 2's ledger
// starts pre-folded.
test("a FRESH re-materialized review runs its units — the fold spares only a re-levy", () => {
  // ── run 1: the first review — stages inside the store so the fold
  // scan can find it; france settles done, japan/peru stall (the
  // dead-review shape)
  const source1 = mkdtempSync(join(tmpdir(), "whl-p4-src1-"))
  cpSync(FIXTURE, source1, { recursive: true })
  const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-p4", "jobs", "j-p4", "run")
  stageRun(source1, r1)
  const one = port()
  const d1 = depsFor(r1, one.port)
  cycle(d1)
  assert.equal(one.spawned.length, 3, "sanity: run 1 spawns all three units")
  appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
  cycle(d1)
  assert.ok(
    readState(r1).done.includes("france"),
    "sanity: france settled done in run 1's ledger",
  )

  // ── run 2: the drill's second run — the door re-materializes the
  // SAME content (a fresh cpSync of the program; same template, same
  // SHAs, same TITLE) and levies it. NOT a re-levy of run 1's program
  // dir: a fresh program dir, indistinguishable from run 1 only by
  // content — which is exactly the fold's key.
  const source2 = mkdtempSync(join(tmpdir(), "whl-p4-src2-"))
  cpSync(source1, source2, { recursive: true }) // byte-identical re-materialization
  const r2 = mkdtempSync(join(tmpdir(), "whl-p4-run2-"))
  stageRun(source2, r2)
  const two = port()
  const d2 = depsFor(r2, two.port)
  cycle(d2)

  assert.ok(
    two.spawned.includes("w-france"),
    `INV-3: "is this a re-levy of the same program?" is decided by CONTENT hash in run.ts copyBeside, ` +
      `while the repo's own law (skills/yyx-whl/SKILL.md hard rule, run-drill.sh's "five real-agent runs") ` +
      `decides it by PROGRAM-DIR identity — a fresh materialization of identical content is not a re-levy, ` +
      `but the fold spared it anyway: run 2 spawned [${two.spawned.join(", ")}] instead of re-running france. ` +
      `The weekly drill's second run replays run 1's lens verdicts and tests nothing (and a re-review of an ` +
      `unchanged diff can never get the fresh minds the lens preamble promises). ` +
      `run 1 ledger: done=${JSON.stringify(readState(r1).done)}; run 2 ledger: done=${JSON.stringify(readState(r2).done)}`,
  )
  // cleanup guard for the temp store
  rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions", "s-p4"), { recursive: true, force: true })
})
