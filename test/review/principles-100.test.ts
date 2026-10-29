import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p100-home-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place — "does an infra death condemn the
// plan?") / INV-4 (the honest-label law: canary-stopped is reserved for
// "a REAL answer failed and stopped the line").
//
// This diff aligned FOUR transport-class closes in
// src/engines/orchestrator.ts to `faultsCanary: false, fault: true` and
// wrote the law into their comments:
//   - the birth judge's close (r16): "infra says nothing about the plan"
//   - the fault-lane exhaustion close (r16): "an exhausted model ladder
//     is pure transport"
//   - the spawn-failure close (r19): "the third close of the same infra
//     class"
//   - the livenessJudge's pane-dead close (r22): "the FOURTH
//     transport-class close"
// The FIFTH close of the same class — the wave-blocked close
// (orchestrator.ts, `finish(unit.id, false, { result: "wave blocked by
// failed …" }, "wave")`) — kept the OLD answer: faultsCanary defaults
// TRUE, fault defaults FALSE. A wave-blocked unit never answered
// anything (it never ran), and when the blocking failure is itself a
// grade FAULT — runGrade's own doctrine: "silence + non-zero = the hook
// itself is broken … an infra fault, never an answer fault" — the
// blocked close trips canary.failed on a death the file's own law says
// cannot trip it. The run then reports "canary-stopped", the label the
// honest-label block (orchestrator.ts, "#144") reserves for "a REAL
// answer failed and stopped the line", and the blocked row settles as a
// plain FAILED card (fault=false) — counted toward answer pass-rates,
// regrade cannot re-enter, the stated benefit of every aligned twin.
//
// Path that breaks: `whl run` of a two-wave chain ([[stage]] alpha,
// then [[stage]] beta) with canary on (the run default:
// engine.ts "wf?.canary !== false") and a broken/silent grade hook (the
// arm-e night class — #144: "28/33 'canary-stops' were exit-127s with
// zero artifacts wearing answer-failure labels"). Alpha finishes done;
// the grade hook exits non-zero with no stdout (infra per runGrade);
// alpha settles as a grade-fault card WITHOUT tripping the canary; the
// wave machinery then closes beta as "wave blocked by failed alpha" —
// and THAT close trips the canary the alpha fault correctly spared.
//
// Deterministic, no timers: the direct runOrchestrator harness (the
// principles-4/principles-42 device) — a fake port whose worker pens
// the done marker; the grade hook is the literal `false` command
// (silent non-zero exit = the infra shape runGrade itself names).
test("a wave blocked by a grade-FAULT must not stop the line as 'a REAL answer failed' (#144)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-p100-run-"))
  cpSync(FIXTURE, dir, { recursive: true })
  try {
    // two waves: stage alpha carries the task verifier (grade: true);
    // stage beta is gated behind it. The grade hook is BROKEN infra:
    // silent non-zero exit — runGrade's own "infra fault, never an
    // answer fault" shape.
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "p100"`,
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
        // the worker's own pen: alpha finishes done — the GRADE hook is
        // what fails, and it fails as infra (silent non-zero)
        const unitDir = dirname(briefPath)
        writeFileSync(join(unitDir, "log.txt"), `done alpha\n`)
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

    // premise: alpha's death landed as an INFRA card (grade-fault), and
    // beta was closed by the wave machinery — the close under judgment ran
    const alpha = report?.table.find((r) => r.unit === "alpha")
    const beta = report?.table.find((r) => r.unit === "beta")
    assert.ok(alpha && !alpha.pass, `premise: alpha settled failed (got ${JSON.stringify(report?.table)})`)
    assert.match(
      alpha?.result ?? "",
      /^grade-fault:/,
      `premise: alpha's death is INFRA — a silent broken grade hook (runGrade's own doctrine: "an infra fault, never an answer fault"); got ${JSON.stringify(alpha)}`,
    )
    assert.ok(beta && !beta.pass, "premise: beta was closed by the wave machinery (the close ran)")

    // THE LAW: no REAL answer exists anywhere on this path — alpha's
    // grade hook was broken (infra per runGrade and per the aligned
    // closes' own comments) and beta never ran. The run's status must
    // not claim one did.
    assert.notEqual(
      report?.status,
      "canary-stopped",
      `INV-4/INV-3: "does an infra death condemn the plan?" is answered FIVE times in src/engines/orchestrator.ts, ` +
        `and this diff aligned four of the five transport closes to faultsCanary:false + fault:true (birth judge r16, ` +
        `fault-lane r16, spawn-fail r19, pane-dead r22 — each comment states the same law: "infra says nothing about ` +
        `the plan; 'canary-stopped' is the label reserved for 'a REAL answer failed'"). The FIFTH close of that class ` +
        `— the wave-blocked close (finish(…, "wave") with the OLD defaults faultsCanary:true, fault:false) — kept the ` +
        `old answer: alpha's grade hook failed as INFRA (silent non-zero — the runGrade card reads "${alpha?.result}", ` +
        `a grade-fault that correctly did NOT trip the canary), beta never ran, and the wave-blocked close tripped ` +
        `canary.failed anyway — the run reported "${report?.status}", the honest-label block's own reserved label ` +
        `("a REAL answer failed and stopped the line", #144) with no answer anywhere on the path. The blocked row also ` +
        `settles as a plain FAILED card (fault=false), so it counts toward answer pass-rates and regrade cannot re-enter ` +
        `— the exact double harm principles-42 fixed for the pane-dead twin. Pass faultsCanary:false + fault:true from ` +
        `the wave-blocked close, like its four aligned twins.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
  }
})
