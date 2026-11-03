// Fault: inhabitPane treats any status other than working|blocked as a
// ghost and shep-retires. Empty/unparsed agent get is "unknown", which
// is not an observation of not-working (INV-1). The brief-retry sleep
// is the only wait before that retire.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused brief does not retire when agent_status was never observed not-working (INV-1)", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "tests-2-unknown-"))
  mkdirSync(join(dir, "briefs"))
  const brief = join(dir, "briefs", "actor.md")
  writeFileSync(brief, "You are the actor.\n")
  const calls: string[][] = []
  const retired: string[] = []
  const rail = new Rail({
    argvDir: dir,
    ledger: null,
    log: () => {},
    transport: {
      exec: (cmd: string, ...args: string[]) => {
        calls.push([cmd, ...args])
        if (cmd === "agent" && args[0] === "get") {
          // start succeeded; status has not landed — not idle, not done
          return { status: 0, stdout: "", stderr: "" }
        }
        if (cmd === "agent" && args[0] === "prompt") return { status: 1, stdout: "", stderr: "brownout" }
        if (cmd === "agent" && args[0] === "start") return { status: 0, stdout: "", stderr: "" }
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "retire") retired.push(args.join(" "))
      return { status: 0, stdout: "" }
    },
  })
  rail.inhabitPane("actor", "opencode", "p-1", brief, dir, undefined, undefined, false, undefined)
  const statusReads = calls.filter((c) => c[0] === "agent" && c[1] === "get")
  assert.ok(statusReads.length >= 1, "precondition: agent_status was asked")
  assert.equal(
    retired.length,
    0,
    `INV-1: refused brief retired the pane (${retired.join("; ") || "none"}) on an unobserved status (empty agent get → unknown), not on observed not-working`,
  )
})
