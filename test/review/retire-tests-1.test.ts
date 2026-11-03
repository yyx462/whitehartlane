// Fault: grace-reprompt exhaustion returns inhabit() false AFTER agent
// start succeeded. rail.inhabitPane then shep-retires immediately.
// INV-1: retire must wait on observed not-working, never on the retry
// sleep. Resume was spared (returns true); the fresh-birth twin was not.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused birth brief must not retire a pane still agent_status working", () => {
  const dir = mkdtempSync(join(tmpdir(), "tests-1-retire-"))
  const briefPath = join(dir, "briefs", "actor.md")
  mkdirSync(join(dir, "briefs"), { recursive: true })
  writeFileSync(briefPath, "brief body\n")
  const prev = {
    tries: process.env.AGENTIC_OS_BRIEF_TRIES,
    pause: process.env.AGENTIC_OS_BRIEF_BACKOFF_MS,
    jitter: process.env.AGENTIC_OS_BIRTH_JITTER_MS,
    startTries: process.env.AGENTIC_OS_START_TRIES,
    startPause: process.env.AGENTIC_OS_START_BACKOFF_MS,
  }
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  let status = "idle"
  let retiredWhileWorking = false
  let sawGetBeforeRetire = false
  const rail = new Rail({
    argvDir: dir,
    ledger: null,
    log: () => {},
    shepRunner: (args) => {
      if (args[0] === "retire") {
        sawGetBeforeRetire = true
        if (status === "working") retiredWhileWorking = true
      }
      return { status: 0, stdout: "" }
    },
    herdrRunner: (args) => {
      if (args[0] === "agent" && args[1] === "start") {
        status = "working"
        return { status: 0, stdout: "" }
      }
      if (args[0] === "agent" && args[1] === "get") {
        return { status: 0, stdout: JSON.stringify({ agent_status: status }) }
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { status: 1, stdout: "" }
      }
      return { status: 0, stdout: "" }
    },
  })
  try {
    const ok = rail.inhabitPane("actor", "opencode", "p-1", briefPath, dir, undefined, undefined, false, undefined)
    assert.equal(ok, false, "premise: exhausted brief delivery fails the birth")
    assert.equal(
      retiredWhileWorking,
      false,
      `INV-1: brief delivery failed after agent start left agent_status working, and inhabitPane retired anyway (get-before-retire=${sawGetBeforeRetire}) — a fixed retry sleep is not an observed not-working wait`,
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
  }
})
