// INV-1: a refused brief after a successful agent start must not retire
// a pane that is still working. The grace-reprompt loop
// (src/adapters/opencode-host.ts) sleeps on a timer between prompt
// refusals, then returns false. rail.inhabitPane treats that false as
// "agent start failed" and shep-retires without ever reading
// agent_status. The sleep is the wait; observed not-working is not.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused brief after agent start does not retire a pane that is still working (INV-1)", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "2"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "momentum-brief-retire-"))
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
          return { status: 0, stdout: '{"agent_status":"working"}', stderr: "" }
        }
        if (cmd === "agent" && args[0] === "prompt") return { status: 1, stdout: "", stderr: "brownout" }
        if (cmd === "agent" && args[0] === "start") return { status: 0, stdout: "", stderr: "" }
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "retire") retired.push(args.join(" "))
      if (args[0] === "record") return { status: 0, stdout: "" }
      return { status: 0, stdout: "" }
    },
  })
  // fresh non-hold birth: start succeeds, brief is refused, agent is working
  rail.inhabitPane("actor", "opencode", "p-1", brief, dir, "zhipuai/glm-5.3", undefined, false, undefined)
  const statusReads = calls.filter((c) => c[0] === "agent" && c[1] === "get")
  const starts = calls.filter((c) => c[0] === "agent" && c[1] === "start")
  assert.ok(starts.length >= 1, "precondition: agent start was issued")
  assert.equal(
    retired.length,
    0,
    `INV-1: a refused brief after a successful start retired the pane (${retired.join("; ") || "none"}) after a fixed brief-retry sleep; agent_status was still working and was never the wait (status reads=${statusReads.length})`,
  )
})
