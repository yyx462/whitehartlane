import assert from "node:assert/strict"
import { appendFileSync, cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum4-"))

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

const TIGHT_GRADE = `#!/usr/bin/env bash
# v2 — the bar changed between run 1 and run 2 (an author fix to the
# program's quality gate). Nothing passes until the work is re-derived.
echo "rejected: grade bar tightened"
exit 1
`

// INV-3/INV-4 — the re-levy fold (src/doors/run.ts copyBeside) vouches
// "same program" with an identity marker hashing ONLY {workflow.toml,
// data/, members/}. The run's own grade/check hooks are NOT in it —
// yet stageRun stages hooks/ into every run dir and resolves every
// hook command against the RUN dir's own hooks (ADR 0016 slice 3,
// stageRun's comment), and the repo already owns the whole-dir hash
// for exactly this question (book(): contentHashOf(dir) as the spur
// version, with the f313a23c receipt: "the program text alone does not
// identify a run; its surroundings do").
//
// The path that breaks: run 1 settles a unit done under grade hook v1;
// the author tightens the hook (the rail's own r1..r12 loop: fix the
// check, re-levy) and re-levies the SAME program dir. The marker
// matches (hooks invisible to it), so run 2 folds the done unit in —
// its ledger now claims a settle run 2's own hooks never made, the
// pump never spawns the unit, and the report/verdict carries run 1's
// judgment under the retired bar. On BASE (no fold) the re-levy
// re-runs the unit and the new hook judges it.
test("a re-levy does not fold a done unit across a changed grade hook", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-m4-src-"))
  cpSync(FIXTURE, source, { recursive: true })

  // ── run 1: the first `whl run <program dir>`
  const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m4", "jobs", "j-m4", "run")
  stageRun(source, r1)
  const one = port()
  const d1 = depsFor(r1, one.port)
  cycle(d1)
  assert.equal(one.spawned.length, 3, "sanity: run 1 spawns all three units")

  // france settles done under grade.sh v1 (the fixture's: any
  // non-empty result.md passes); japan/peru stall — the dead-review shape
  appendFileSync(join(r1, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(r1, "units", "france", "result.md"), "Paris\n")
  cycle(d1)
  assert.ok(
    readState(r1).done.includes("france"),
    "sanity: france settled done in run 1's ledger",
  )

  // ── the author tightens the program's grade hook and re-levies the
  // SAME program dir (the manual's own recovery spell)
  writeFileSync(join(source, "hooks", "grade.sh"), TIGHT_GRADE)
  const r2 = mkdtempSync(join(tmpdir(), "whl-m4-run2-"))
  stageRun(source, r2)
  const two = port()
  const d2 = depsFor(r2, two.port)
  cycle(d2)

  assert.ok(
    !readState(r2).done.includes("france"),
    `INV-3/INV-4: the fold's identity marker hashes only {workflow.toml, data/, members/} ` +
      `(run.ts copyBeside) but the run executes the run-dir's OWN hooks (ADR 0016 slice 3) — ` +
      `so a done verdict made under grade.sh v1 folded forward into a run whose grade.sh v2 ` +
      `would fail it: run 2 ledger done=${JSON.stringify(readState(r2).done)}, no spawn, no re-judgment. ` +
      `The repo already hashes the whole program dir for the spur version (book(), contentHashOf(dir), ` +
      `the f313a23c receipt); the marker must see the hooks too. ` +
      `run 1 ledger: done=${JSON.stringify(readState(r1).done)}`,
  )
})
