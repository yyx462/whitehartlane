// INV-1: a refused birth brief must not retire a pane whose agent
// already started and is still working. opencode-host.ts returns false
// after the start loop succeeded and the brief retries failed. rail
// inhabitPane's !ok arm shep-retires immediately. The resume twin a few
// lines above keeps the birth; the fresh twin does not observe
// agent_status before the retire.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused fresh brief does not retire a pane that is still working", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "principles-fresh-retire-"))
  const brief = join(dir, "brief.md")
  writeFileSync(brief, "do the work\n")
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
      return { status: 0, stdout: "" }
    },
  })
  rail.inhabitPane("w-france", "opencode", "p-1", brief, dir)
  const statusReads = calls.filter((c) => c[0] === "agent" && c[1] === "get")
  const started = calls.some((c) => c[0] === "agent" && c[1] === "start")
  assert.equal(
    started && retired.length > 0 && statusReads.length === 0,
    false,
    `INV-1: brief refusal after a successful agent start retired the pane (${retired.join("; ") || "none"}) while agent_status was still working and was never observed (status reads=${statusReads.length}, started=${started})`,
  )
})
