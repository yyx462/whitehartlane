import assert from "node:assert/strict"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p38-store-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(ROOT, "test", "fixtures", "three-lookups")

// INV-4 (an infra failure is never reported as an answer) + INV-3 (the
// canary decision is answered twice, oppositely). The repo's own law —
// orchestrator.ts, the finish() comment and the #144 receipt — says the
// stop-the-line canary exists "to protect slots from a doomed PLAN, and
// a broken hook says nothing about the plan"; the markerJudge's
// grade-fault close therefore passes faultsCanary:false, and the report
// label law (orchestrator.ts, "the honest label") reserves
// "canary-stopped" for "a REAL answer failed". THIS diff turned the
// provider-fault lane live (runOrchestrator now forwards input.faults
// to cycle — at BASE the lane was dead code, unreachable from a run).
// The lane's close passes faultsCanary=TRUE: when the model ladder is
// exhausted (pure transport — the provider is down, the plan says
// nothing), the close trips canary.failed and the run reports
// "canary-stopped" — an infra death wearing the "a REAL answer failed"
// label. The twin (grade-fault) answers the same question the other
// way, one seat away in the same file.
test("a provider-fault close must not claim a REAL answer stopped the line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-p38-"))
  cpSync(FIXTURE, dir, { recursive: true })
  // ONE candidate model, pinned on every unit: the FIRST provider fault
  // exhausts the ladder and the fault lane closes the unit (the lane's
  // own honest death walk).
  writeFileSync(join(dir, "models.json"), JSON.stringify({ mode: "ask", order: ["prov/one"] }))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      "[workflow]",
      `name = "p38"`,
      `worker_kind = "opencode"`,
      "slots = 2",
      "",
      "[hooks]",
      `grade = "bash hooks/grade.sh"`,
      `counts = "bash hooks/counts.sh"`,
      "",
      "[[stage]]",
      `id = "lookups"`,
      `topology = "fan-out"`,
      "units = [",
      `  { id = "france", model = "prov/one", brief = "look up France" },`,
      `  { id = "japan", model = "prov/one", brief = "look up Japan" },`,
      `  { id = "peru", model = "prov/one", brief = "look up Peru" },`,
      "]",
      "",
      "[report]",
      `where = "units/"`,
      "",
      "[layout]",
      `tab = "new"`,
      `orchestrator = "left"`,
      "",
    ].join("\n"),
  )

  const retired: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    workerStatus: () => "idle",
    reprompt: () => true,
    retire: (name) => {
      retired.push(name)
    },
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
    faults: {
      sessionOf: () => "s-1",
      cwdOf: () => dir,
      workerStatus: () => "idle",
      latestSessionFault: () => ({ id: "f1", type: "provider.rate-limit" }),
      switchSessionModel: () => ({ ok: true }),
      promptAgent: () => {},
    },
  })

  // premise (both ends): the unit died honestly and its pane was retired
  assert.ok(retired.includes("w-france"), "premise: the unit's pane was retired")
  const france = report?.table.find((r) => r.unit === "france")
  assert.ok(france, "premise: the unit closed with a row")
  assert.ok(!france.pass, "premise: the row is a failure")

  // THE LAW: the exhaustion close is INFRA (the provider died, the
  // ladder ran out). The grade-fault twin cannot trip the canary and
  // cannot claim this label; the fault-lane close must not either.
  assert.notEqual(
    report?.status,
    "canary-stopped",
    `INV-4/INV-3: the provider-fault close (fault-lane path, run live by this diff's ` +
      `faults: input.faults forwarding) reported "${report?.status}" — it tripped canary.failed on an ` +
      `INFRA death and took the "a REAL answer failed and stopped the line" label. The repo's own law ` +
      `(finish() comment, #144; the honest-label block) says infra says nothing about the plan, and the ` +
      `grade-fault close in the same file passes faultsCanary:false for exactly this reason. One decision ` +
      `— "does an infra death condemn the plan?" — answered NO by the grade-fault close and YES by the ` +
      `fault-lane close. Pass faultsCanary:false from the lane's close, like its twin.`,
  )
})
