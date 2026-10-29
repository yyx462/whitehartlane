import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p42-store-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-4 (an infra failure is never reported as an answer) + INV-3 (one
// decision — "does this death condemn the plan?" — answered per close
// in orchestrator.ts). This diff aligned THREE transport-class closes
// to `faultsCanary: false, fault: true` — the birth judge's close
// ("dead at birth"), the fault-lane exhaustion close, and the spawn-fail
// close, whose own comment says: "a spawn that keeps failing is pure
// transport — the third close of the same infra class as the
// fault-lane and birth-judge closes … (#144: infra says nothing about
// the plan; 'canary-stopped' is the label reserved for 'a REAL answer
// failed')". The FOURTH close of the same infra class — the
// livenessJudge's "pane dead" close (a pane whose process is GONE, so
// it can never answer) — kept the old answer: `faultsCanary` defaults
// TRUE and `fault` defaults FALSE, so a pane death trips canary.failed
// and the run's honest-label block reports "canary-stopped" — the label
// whose own law (orchestrator.ts, "The honest label (#144): two
// distinct stops. canary.failed = a REAL answer failed and stopped the
// line") claims an answer that never existed. The card is also a plain
// FAILED card, not a grade-fault card — regrade cannot re-enter, the
// stated benefit of every aligned twin. Same posture as momentum-40:
// the law is this diff's own; the twin is old (the close behaves
// identically on BASE — that is the incomplete-fix class, not a
// pre-existing decision this review endorses).
test("a pane that dies without answering must not stop the line as 'a REAL answer failed'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-p42-"))
  cpSync(FIXTURE, dir, { recursive: true })
  try {
    // the pane spawns and then DIES — no log line, no marker, no
    // session: nothing that is an answer exists anywhere on this path
    const port: ShepPort = {
      setLayout: () => {},
      spawnWorker: () => true,
      paneAlive: () => false,
      workerStatus: () => "unknown",
      reprompt: () => true,
      retire: () => {},
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    }
    const report = await runOrchestrator({
      taskDir: dir,
      shep: port,
      canary: true,
      deadlineMs: 5_000,
      log: () => {},
    })

    // premise: the death landed as a unit failure (the close happened,
    // the liveness judge ruled — this is not a vacuous pass)
    const france = report?.table.find((r) => r.unit === "france")
    assert.ok(france, "premise: the pane-death close produced a report row")
    assert.ok(!france.pass, "premise: the row is a failure (the pane died un answered)")

    // THE LAW: the canary label is reserved for a REAL answer that
    // failed (#144, the honest-label block). A pane death is transport
    // — the same class the diff's own spawn-fail comment names — so the
    // close must ride faultsCanary:false + fault:true like its three
    // aligned twins, and the run must NOT report "canary-stopped".
    assert.notEqual(
      report?.status,
      "canary-stopped",
      `INV-4/INV-3: "does this death condemn the plan?" is answered four times in src/engines/orchestrator.ts, ` +
        `and this diff aligned three of the four transport closes to faultsCanary:false + fault:true (birth close, ` +
        `fault-lane close, spawn-fail close — the spawn-fail comment itself names "the same infra class"). The ` +
        `fourth close of that class — livenessJudge's "pane dead" close — kept the old answer (faultsCanary ` +
        `defaults true, fault defaults false): a pane that died WITHOUT ANSWERING tripped canary.failed and the ` +
        `run reported "${report?.status}" — the honest-label block's own law says that label means "a REAL answer ` +
        `failed and stopped the line", and no answer exists on this path (no marker, no session, no log line — ` +
        `the pane process is gone). The card is also a plain FAILED card, not a grade-fault card, so regrade ` +
        `cannot re-enter — the stated benefit of every aligned twin. Pass faultsCanary:false, fault:true from the ` +
        `pane-dead close, like its three aligned twins.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
  }
})
