// Q4/INV-1: a refused brief must not retire unless agent_status is
// OBSERVED not-working. "unknown" (agent get returned no grammar) is
// not that observation — the new branch still shep-retires it.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused brief must not retire when agent_status is unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "questions-1-"))
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
  let retired = false
  const rail = new Rail({
    argvDir: dir,
    ledger: null,
    log: () => {},
    shepRunner: (args) => {
      if (args[0] === "retire") retired = true
      return { status: 0, stdout: "" }
    },
    herdrRunner: (args) => {
      if (args[0] === "agent" && args[1] === "start") return { status: 0, stdout: "" }
      if (args[0] === "agent" && args[1] === "get") return { status: 0, stdout: "" }
      if (args[0] === "agent" && args[1] === "prompt") return { status: 1, stdout: "" }
      return { status: 0, stdout: "" }
    },
  })
  try {
    const ok = rail.inhabitPane("actor", "opencode", "p-1", briefPath, dir, undefined, undefined, false, undefined)
    assert.equal(ok, false, "premise: exhausted brief delivery fails the birth")
    assert.equal(
      retired,
      false,
      "INV-1: brief delivery failed and agent_status was unknown (not observed idle), but inhabitPane shep-retired the pane — unknown is not observed not-working",
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
