import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p40-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import {
  cycle,
  type CanaryState,
  type CycleDeps,
  type ShepPort,
} from "../../src/engines/orchestrator.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { readState } from "../../src/core/state.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place) / INV-4 (infra is never an answer).
//
// "Does an infra death condemn the plan — trip the stop-the-line
// canary?" is answered THREE times in src/engines/orchestrator.ts, and
// this change fixed two of the three sites while stating the law in
// their own comments:
//   - the fault-lane close (exhausted model ladder, :1088-1098):
//     `finish(id, false, …, "unit", false, true)` — "faultsCanary FALSE
//     (gate-r16 principles-38): an exhausted model ladder is pure
//     transport — the provider died, the plan said nothing … the
//     stop-the-line label ('a REAL answer failed') is reserved for
//     answers";
//   - the birth judge's close (never boarded, :962-977):
//     faultsCanary: false, fault: true — "transport, never an answer
//     (gate-r16 tests-2) … never trips the canary (#144: infra says
//     nothing about the plan)";
//   - the SPAWN-FAILURE close (the claim path's RETRY_CAP rung,
//     :1172-1180): `finish(unit.id, false, …, "spawn", true, false, …)`
//     — faultsCanary TRUE, fault FALSE. A spawn that cannot be born is
//     the purest transport class there is (the multiplexer is down; no
//     plan content exists to condemn), and finish() with
//     faultsCanary=true sets canary.failed — the run then reports
//     "canary-stopped", the label the file's own honest-label block
//     (:1917-1918) reserves for "a REAL answer failed and stopped the
//     line", and the row settles as an ANSWER (fault=false), not a
//     fault card. The grade-fault twin's immunity is pinned twice in
//     test/orchestrator.test.ts (#144, :733/:755); the spawn-failure
//     twin one seat away never got the same answer.
//
// Path that breaks: `whl run` while the multiplexer is down (or any
// spawn port that refuses — pane split with no live anchor, CLI
// transport failure). Three failed spawns close the unit, the canary
// trips, and the report.json status claims an answer stopped the line.
//
// Deterministic, no timers: the direct cycle() harness (the
// principles-4 device) — spawnWorker always refuses; three cycles run
// the claim path to its RETRY_CAP close.
test("a spawn-failure close is transport — it must not trip the stop-the-line canary (#144)", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-p40-run-"))
  cpSync(FIXTURE, dir, { recursive: true })
  try {
    const canary: CanaryState = { enabled: true, released: false, failed: false }
    const port: ShepPort = {
      setLayout: () => {},
      // THE SHAPE UNDER JUDGMENT: every spawn refuses — the multiplexer
      // is down (infra; no agent, no session, no plan content involved)
      spawnWorker: () => false,
      paneAlive: () => true,
      workerStatus: () => "unknown",
      reprompt: () => true,
      retire: () => {},
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    }
    const deps: CycleDeps = {
      taskDir: dir,
      hooks: hooksFromDir(dir).hooks,
      shep: port,
      inFlight: new Map(),
      attempts: new Map(),
      slots: 3,
      canary,
      log: () => {},
    }

    cycle(deps) // every claim's spawn fails — attempt 1
    cycle(deps) // attempt 2
    cycle(deps) // attempt 3 → the RETRY_CAP close fires

    // premise: the spawn-failure close really ran (the unit settled failed)
    const state = readState(dir)
    assert.ok(
      state.failed.includes("france"),
      `premise: three refused spawns closed france via the RETRY_CAP close (got failed=${JSON.stringify(state.failed)})`,
    )

    // THE LAW: a spawn failure is transport (#144 — infra says nothing
    // about the plan). The two seats this change fixed pass
    // faultsCanary:false for exactly this class; the spawn-failure seat
    // must answer the same way, or the run's status lies that a REAL
    // answer stopped the line.
    assert.equal(
      canary.failed,
      false,
      `INV-4/INV-3: "does an infra death condemn the plan?" is answered THREE ways in src/engines/orchestrator.ts. ` +
        `The fault-lane close passes faultsCanary:false ("an exhausted model ladder is pure transport — the provider ` +
        `died, the plan said nothing", :1088-1098) and the birth judge's close passes faultsCanary:false + fault:true ` +
        `("transport, never an answer … never trips the canary (#144: infra says nothing about the plan)", :962-977) — ` +
        `but the spawn-failure close (:1172-1180, finish(…, "spawn", true, false, …)) passes faultsCanary:TRUE and ` +
        `fault:FALSE, so three refused spawns (multiplexer down — the purest transport class: no agent ever existed to ` +
        `answer anything) tripped canary.failed (canary=${JSON.stringify(canary)}). The run's status becomes ` +
        `"canary-stopped" — the label the file's own honest-label block (:1917-1918) reserves for "a REAL answer failed ` +
        `and stopped the line" — and the row settles as an ANSWER (fault=false), not a fault card, so it counts toward ` +
        `answer pass-rates. The grade-fault twin's immunity is pinned twice in test/orchestrator.test.ts (#144); ` +
        `the spawn-failure twin one seat away was left answering the opposite way by the same change that wrote the ` +
        `law into its siblings' comments: the incomplete-fix class. Pass faultsCanary:false (and fault:true) from the ` +
        `spawn-failure close, like its two twins.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
  }
})
