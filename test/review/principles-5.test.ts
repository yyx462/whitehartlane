import assert from "node:assert/strict"
import { cpSync, mkdtempSync, appendFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-principles5-"))

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

// INV-3 (twin paths — "is this staging the same program as a prior
// run?") — the diff answers that question TWICE with different
// predicates:
//   - project.ts book()/registerSpur: contentHashOf(dir) — the WHOLE
//     source dir hash, as the spur version, carrying the f313a23c
//     receipt: "the program text alone does not identify a run; its
//     surroundings do".
//   - run.ts copyBeside's .whl-program fold identity: sha1 of
//     {workflow.toml, hooks/, data/, members/} + the source PATH only.
// Yet copyBeside stages five more program inputs the identity never
// sees: questions.toml (run.ts:126-129 — staged INTO data/, the units'
// shared shelf), task.txt (the commission book() reads at run.ts:303),
// actor.md, roots.txt, contract.toml. The fold's own comment states the
// law it then under-implements (run.ts:150-152): "folded verdicts must
// be the new run's OWN hooks' verdicts … changed hooks never match and
// the unit re-runs".
//
// The path that breaks: run 1 of a program dies mid-chain with one unit
// done; the author edits the program's question bank (or task line) and
// re-levies the SAME program dir — the recovery the manual prescribes.
// The identity matches anyway, so run 2's ledger claims a settle made
// under inputs run 2 never served: the exact wrong-replay momentum-4
// pinned for hooks/, still open for the files beside them.
test("a re-levy does not fold a done unit across a changed program input the fold stages", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-p5-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  // the program carries a question bank at its root — copyBeside stages
  // it into data/questions.toml, the units' shared shelf
  writeFileSync(
    join(source, "questions.toml"),
    '# bank v1\n\n[[question]]\nid = "q1"\nprompt = "What is the capital of France?"\n',
  )

  // ── run 1: the first `whl run <program dir>`
  const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-p5", "jobs", "j-p5", "run")
  stageRun(source, r1)
  const one = port()
  const d1 = depsFor(r1, one.port)
  cycle(d1)
  assert.equal(one.spawned.length, 3, "sanity: run 1 spawns all three units")

  // france settles done under bank v1; japan/peru stall — the
  // dead-review shape the re-levy law addresses
  appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
  cycle(d1)
  assert.ok(
    readState(r1).done.includes("france"),
    "sanity: france settled done in run 1's ledger",
  )

  // ── the author edits the program's question bank and re-levies the
  // SAME program dir (the manual's own recovery spell)
  writeFileSync(
    join(source, "questions.toml"),
    '# bank v2 — the bank changed between run 1 and run 2\n\n[[question]]\nid = "q1"\nprompt = "What is the capital of France, IN FRENCH?"\n',
  )
  const r2 = mkdtempSync(join(tmpdir(), "whl-p5-run2-"))
  stageRun(source, r2)
  const two = port()
  const d2 = depsFor(r2, two.port)
  cycle(d2)

  assert.ok(
    !readState(r2).done.includes("france"),
    `INV-3/INV-4: the fold's identity marker hashes only {source path, workflow.toml, hooks/, data/, members/} ` +
      `(run.ts copyBeside), but copyBeside stages questions.toml into data/ (run.ts:126-129) and task.txt ` +
      `(run.ts:131-133, the commission book() reads) without either joining the identity — so a done verdict ` +
      `made under bank v1 folded forward into a re-levy whose staged bank is v2: run 2 ledger ` +
      `done=${JSON.stringify(readState(r2).done)}, no spawn, no re-judgment under the inputs run 2 actually serves. ` +
      `The repo's own twin (project.ts contentHashOf(dir) as the spur version, the f313a23c receipt "the program ` +
      `text alone does not identify a run; its surroundings do") hashes the WHOLE dir; the fold's own law ` +
      `(run.ts:150-152, momentum-4) says changed inputs never match and the unit re-runs. ` +
      `run 1 ledger: done=${JSON.stringify(readState(r1).done)}`,
  )
})
