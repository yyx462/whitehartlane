// Fault: a refused actor brief is now an honest inhabit() false
// (opencode-host.ts), but lab.ts still logs and continues. A protocol.json
// that already says stop then becomes a "done" report — infra reported
// as an answer (INV-4). A fresh dir with no stop hangs the 2h loop and
// writeReport defaults empty rows to done.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLab } from "../../src/engines/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("a lab whose actor brief never lands must not report done", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tests-1-lab-birth-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "lab"',
      "",
      "[workflow]",
      'name = "tests-1-lab-birth"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")
  // the loop's only fast exit — the actor never wrote this; it is already
  // on disk the way a re-entered task dir is
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))

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
    const report = await runLab(fakeRail(dir, herdr, fakeLedger() as never), { graceMs: 0 })
    assert.notEqual(
      report?.status,
      "done",
      `INV-4: a refused actor brief is infra — the lab must not answer done (got ${JSON.stringify(report?.status)} table ${JSON.stringify(report?.table)})`,
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
