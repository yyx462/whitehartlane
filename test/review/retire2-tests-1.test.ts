// Fault: a refused brief after a successful start leaves a working/blocked
// pane off rail.mine (inhabitPane returns before mine.add). The run's reap
// is retireAll, which only walks mine — so the pane the comment says the
// reap owns is never retired, never privilege-swept, and survives the job.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a live pane whose brief never landed is still owned by the run's reap (INV-1)", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  process.env.AGENTIC_OS_START_TRIES = "1"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "tests-1-orphan-"))
  mkdirSync(join(dir, "briefs"))
  const brief = join(dir, "briefs", "actor.md")
  writeFileSync(brief, "You are the actor.\n")
  const retired: string[] = []
  const recorded: string[] = []
  const rail = new Rail({
    argvDir: dir,
    ledger: null,
    log: () => {},
    transport: {
      exec: (cmd: string, ...args: string[]) => {
        if (cmd === "agent" && args[0] === "get") {
          return { status: 0, stdout: '{"agent_status":"working"}', stderr: "" }
        }
        if (cmd === "agent" && args[0] === "prompt") return { status: 1, stdout: "", stderr: "brownout" }
        if (cmd === "agent" && args[0] === "start") return { status: 0, stdout: "", stderr: "" }
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "record") recorded.push(args.join(" "))
      if (args[0] === "retire") retired.push(args.join(" "))
      return { status: 0, stdout: "" }
    },
  })
  const ok = rail.inhabitPane("actor", "opencode", "p-1", brief, dir, undefined, undefined, false, undefined)
  assert.equal(ok, false, "premise: exhausted brief delivery fails the birth")
  assert.equal(retired.length, 0, "premise: a working pane is not retired at the refusal")
  assert.ok(recorded.length >= 1, "premise: shep recorded the pane before the brief failed")
  rail.retireAll()
  assert.ok(
    retired.length >= 1,
    `INV-1: brief never landed and agent_status was working, but the pane was not added to the set retireAll walks — the run's reap retired nothing (${retired.join("; ") || "none"}) after record (${recorded.join("; ")}). Leaving it off mine is not "the reap owns it".`,
  )
})
