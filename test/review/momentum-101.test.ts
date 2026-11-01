import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m101-home-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// MOMENTUM (an ordering that only holds on the happy path) + INV-3 /
// INV-4 — the wave gate's blocked close assumes the blocker was a REAL
// failed answer. This diff aligned FOUR transport-class closes in
// src/engines/orchestrator.ts to faultsCanary:false + fault:true and
// wrote the law into each comment ("infra says nothing about the
// plan", #144: "canary-stopped" is reserved for "a REAL answer
// failed"): the birth close, the fault-lane exhaustion close, the
// spawn-fail close, the pane-dead close. The FIFTH close of the same
// family — the wave gate's blocked close (orchestrator.ts:1136-1143,
// `finish(unit.id, false, …, "wave")`) — kept the BASE answer: the
// defaults (faultsCanary TRUE, fault FALSE).
//
// The path that breaks: a two-wave chain, canary on (the run default),
// stage alpha's grade hook broken infra-style (silent non-zero exit —
// runGrade's own "an infra fault, never an answer fault" shape). Alpha
// settles as a grade-FAULT card WITHOUT tripping the canary (the
// diff's own fix, working); the wave machinery then closes beta as
// "wave blocked by failed alpha" — and THAT close trips canary.failed
// on a death that never answered anything. The run reports
// "canary-stopped" — the label the honest-label block reserves for a
// REAL failed answer — and beta settles as a plain FAILED card
// (fault=false): counted toward answer pass-rates, regrade cannot
// re-enter, the stated benefit of every aligned twin denied to the
// one close downstream of them.
//
// Deterministic, no timers: mock workers pen the done marker; the
// grade hook is the literal `false` command.
test("a wave blocked by a grade-FAULT must not stop the line as 'a REAL answer failed' (#144)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-m101-run-"))
  cpSync(FIXTURE, dir, { recursive: true })
  try {
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "m101"`,
        `worker_kind = "mock"`,
        "",
        "[hooks]",
        `grade = "false"`,
        "",
        "[[stage]]",
        `id = "alpha"`,
        `topology = "solo"`,
        `brief = "wave one"`,
        `grade = true`,
        "",
        "[[stage]]",
        `id = "beta"`,
        `topology = "solo"`,
        `brief = "wave two"`,
        "",
      ].join("\n"),
    )

    const port: ShepPort = {
      setLayout: () => {},
      spawnWorker: (_name, _kind, briefPath) => {
        // the worker's own pen: the unit finishes done — the GRADE hook
        // is what fails, and it fails as infra (silent non-zero)
        const unitDir = dirname(briefPath)
        writeFileSync(join(unitDir, "log.txt"), "done alpha\n")
        writeFileSync(join(unitDir, "result.md"), "Paris\n")
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

    const report = await runOrchestrator({
      taskDir: dir,
      shep: port,
      canary: true,
      deadlineMs: 10_000,
      log: () => {},
    })

    // premise: alpha's death landed as an INFRA card (grade-fault — the
    // diff's own alignment, working) and beta was closed by the wave
    // machinery (the close under judgment ran)
    const alpha = report?.table.find((r) => r.unit === "alpha")
    const beta = report?.table.find((r) => r.unit === "beta")
    assert.ok(alpha && !alpha.pass, `premise: alpha settled failed (got ${JSON.stringify(report?.table)})`)
    assert.match(
      alpha?.result ?? "",
      /^grade-fault:/,
      `premise: alpha's death is INFRA per runGrade's own doctrine (silent non-zero hook); got ${JSON.stringify(alpha)}`,
    )
    assert.ok(beta && !beta.pass, "premise: beta was closed by the wave machinery (the close ran)")

    // THE LAW: no REAL answer exists anywhere on this path — alpha
    // answered done and its GRADE HOOK broke; beta never ran. The run
    // must not wear the one label (#144) reserved for "a REAL answer
    // failed and stopped the line".
    assert.notEqual(
      report?.status,
      "canary-stopped",
      `INV-3/INV-4: "does this death condemn the plan?" is answered five times in src/engines/orchestrator.ts, ` +
        `and this diff aligned four transport closes to faultsCanary:false + fault:true (birth, fault-lane ` +
        `exhaustion, spawn-fail, pane-dead — each with the #144 comment). The FIFTH close of the class — the ` +
        `wave gate's blocked close (orchestrator.ts:1136-1143), the only one that fires DOWNSTREAM of a fault ` +
        `close — kept the BASE defaults (faultsCanary true, fault false): with alpha's grade hook broken ` +
        `(infra, correctly spared the canary by the diff's own fix) and beta never spawned, the wave close ` +
        `tripped canary.failed anyway and the run reported "${report?.status}" — the label the honest-label ` +
        `block reserves for "a REAL answer failed and stopped the line", worn by a run in which no answer ` +
        `failed. Beta also settles as a plain FAILED card (fault=false), so regrade cannot re-enter — the ` +
        `stated benefit of every aligned twin, denied to the one close that inherits their deaths. ` +
        `Pass faultsCanary:false + fault:true from the wave-blocked close (or derive them from the blocking ` +
        `failure's own card), like the four aligned twins.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
  }
})
