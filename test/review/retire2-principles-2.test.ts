// INV-1: inhabitPane's new !ok arm retires unless status is exactly
// working or blocked. A get that throws (the same brownout the brief
// retry exists for) is caught and treated as a ghost — retire without
// an observed not-working state, after agent start already succeeded.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("a refused brief must not retire when agent_status cannot be read", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = ORCH
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "principles-2-retire-"))
  mkdirSync(join(dir, "briefs"), { recursive: true })
  const brief = join(dir, "briefs", "actor.md")
  writeFileSync(brief, "do the work\n")
  const retired: string[] = []
  let started = false
  const rail = new Rail({
    argvDir: dir,
    ledger: null,
    log: () => {},
    transport: {
      exec: (cmd: string, ...args: string[]) => {
        if (cmd === "agent" && args[0] === "start") {
          started = true
          return { status: 0, stdout: "", stderr: "" }
        }
        if (cmd === "agent" && args[0] === "prompt") return { status: 1, stdout: "", stderr: "brownout" }
        if (cmd === "agent" && args[0] === "get") throw new Error("agent get brownout")
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "retire") retired.push(args.join(" "))
      return { status: 0, stdout: "" }
    },
  })
  const ok = rail.inhabitPane("actor", "opencode", "p-1", brief, dir)
  assert.equal(ok, false, "premise: exhausted brief delivery fails the birth")
  assert.equal(started, true, "premise: agent start already succeeded")
  assert.equal(
    retired.length,
    0,
    `INV-1: brief refusal after a successful start retired the pane (${retired.join("; ") || "none"}) because agent get threw — a failed observation is not observed not-working`,
  )
})
