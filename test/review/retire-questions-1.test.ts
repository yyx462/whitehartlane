// INV-1: a refused birth brief must not retire a pane that is still
// working. opencode-host.ts sleeps, then returns false when `agent
// prompt` is refused and there is no resumeSession. rail.inhabitPane
// treats every false as "agent start failed" and shep-retires without
// reading agent_status. The resume arm (same function) keeps the birth
// and names agent_status as the life decision; the fresh-birth arm does
// not. Agent start already succeeded, so the pane can be working.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused fresh-birth brief does not retire a pane whose agent_status is working", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  const dir = mkdtempSync(join(tmpdir(), "questions-birth-"))
  mkdirSync(join(dir, "briefs"))
  const brief = join(dir, "briefs", "actor.md")
  writeFileSync(brief, "do the experiment\n")
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
        if (cmd === "agent" && args[0] === "start") return { status: 0, stdout: "", stderr: "" }
        if (cmd === "agent" && args[0] === "prompt") return { status: 1, stdout: "", stderr: "brownout" }
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "retire") retired.push(args.join(" "))
      return { status: 0, stdout: "" }
    },
  })
  // fresh birth: hold=false, no resumeSession — the arm the resume twin does not cover
  rail.inhabitPane("actor", "opencode", "p-1", brief, dir, undefined, undefined, false, undefined)
  const statusReads = calls.filter((c) => c[0] === "agent" && c[1] === "get")
  assert.equal(
    retired.length,
    0,
    `INV-1: a refused fresh-birth brief retired the pane (${retired.join("; ") || "none"}) after the brief-retry sleep; agent_status was working and was never observed (status reads=${statusReads.length}) — the resume arm keeps the birth, this arm does not`,
  )
})
