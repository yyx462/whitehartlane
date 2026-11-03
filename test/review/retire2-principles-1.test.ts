// INV-4 twin: lab.ts records actorBirthFailed and the report seat
// refuses "done", but the drain/park return (lab.ts, before that seat)
// still returns null. A refused actor brief is infra; a pause is not
// a fault row. SIGTERM after a failed birth parks the experiment.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLab } from "../../src/engines/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("a refused actor brief must not park as a clean drain", async () => {
  const dir = mkdtempSync(join(tmpdir(), "principles-1-lab-drain-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "lab"',
      "",
      "[workflow]",
      'name = "principles-1-lab-drain"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")

  const prev = {
    tries: process.env.AGENTIC_OS_BRIEF_TRIES,
    pause: process.env.AGENTIC_OS_BRIEF_BACKOFF_MS,
    jitter: process.env.AGENTIC_OS_BIRTH_JITTER_MS,
    startTries: process.env.AGENTIC_OS_START_TRIES,
    startPause: process.env.AGENTIC_OS_START_BACKOFF_MS,
    orch: process.env.AGENTIC_OS_ORCHESTRATOR,
    db: process.env.OPENCODE_DB,
  }
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_ORCHESTRATOR = ORCH
  process.env.OPENCODE_DB = join(dir, "no-such.db")
  try {
    const herdr = fakeHerdr()
    const inner = herdr.runner
    herdr.runner = (args) => {
      if (args[0] === "agent" && args[1] === "prompt") return { status: 1, stdout: "" }
      return inner(args)
    }
    const rail = fakeRail(dir, herdr, fakeLedger() as never)
    const install = rail.installDrain.bind(rail)
    rail.installDrain = (hook) => {
      const drop = install(hook)
      hook()
      return drop
    }
    const report = await runLab(rail, { graceMs: 0 })
    assert.equal(
      report?.status,
      "failed",
      `INV-4: a refused actor brief is infra — the drain twin must not swallow it as a park (got ${JSON.stringify(report)} )`,
    )
    const actor = report?.table?.find((row) => row.unit === "actor")
    // writeReport's table carries {unit, result} only — `pass` rides
    // through status (amended from the repro's actor?.pass, which the
    // report shape never carried; the law — the missing mind rides the
    // report as a named fault row — is unchanged)
    assert.ok(
      actor && /brief never landed/.test(actor.result),
      `INV-4: the missing mind must ride the report as a fault row (got ${JSON.stringify(actor)})`,
    )
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore("AGENTIC_OS_BRIEF_TRIES", prev.tries)
    restore("AGENTIC_OS_BRIEF_BACKOFF_MS", prev.pause)
    restore("AGENTIC_OS_BIRTH_JITTER_MS", prev.jitter)
    restore("AGENTIC_OS_START_TRIES", prev.startTries)
    restore("AGENTIC_OS_START_BACKOFF_MS", prev.startPause)
    restore("AGENTIC_OS_ORCHESTRATOR", prev.orch)
    restore("OPENCODE_DB", prev.db)
  }
})
