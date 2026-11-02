// A birth whose brief never lands must not be reported as an answer.
// opencode-host.ts returns false after exhausted brief retries ("birth
// fails honestly"). lab.ts logs "actor pane failed" and keeps going;
// with no units, writeReport's default is status "done" (report.ts).
// INV-4: infra is never an answer.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLab } from "../../src/engines/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("INV-4: actor brief that never lands is a fault, not status done", async () => {
  const dir = await mkdtemp(join(tmpdir(), "momentum-actor-birth-"))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "workflow.toml"),
    ['kind = "lab"', "", "[workflow]", 'name = "momentum-actor-birth"', 'worker_kind = "opencode"', "", "[hooks]", 'counts = "printf \'{}\'"', ""].join("\n"),
  )
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")
  // end the loop without waiting out the 2h deadline — a stop file is
  // what a prior generation leaves, and it is also how the engine exits
  // when the actor itself never writes one only after the deadline,
  // which takes the same empty-table "done" default.
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))

  const prevTries = process.env.AGENTIC_OS_BRIEF_TRIES
  const prevPause = process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_ORCHESTRATOR = ORCH
  try {
    const herdr = fakeHerdr()
    const inner = herdr.runner
    herdr.runner = (args: string[]) => {
      if (args[0] === "agent" && args[1] === "prompt") return { status: 1, stdout: "" }
      return inner(args)
    }
    const ledger = fakeLedger()
    const rail = fakeRail(dir, herdr, ledger as never)
    const report = await runLab(rail)
    assert.notEqual(
      report?.status,
      "done",
      `INV-4: actor brief never landed (inhabit returned false, pane retired) but the lab reported status ${JSON.stringify(report?.status)} table ${JSON.stringify(report?.table)} — infra must not be an answer`,
    )
  } finally {
    if (prevTries === undefined) delete process.env.AGENTIC_OS_BRIEF_TRIES
    else process.env.AGENTIC_OS_BRIEF_TRIES = prevTries
    if (prevPause === undefined) delete process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
    else process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = prevPause
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
