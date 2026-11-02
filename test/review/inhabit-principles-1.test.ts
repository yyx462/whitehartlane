// INV-1: a refused continue prompt must not retire a resumed pane that
// is still working. The brief-retry change (opencode-host.ts) returns
// false after fixed sleeps when `agent prompt` is refused. That is the
// right fail-honest law for a FRESH birth. The ADR-5 continue twin does
// not hold: rail.resumeWorker → inhabitPane(..., hold=false, sessionId)
// (rail.ts). Coworker/lab resume pass hold=true, so a refused prompt
// never kills a session that already has the work. Fan-out continue
// starts the resumed agent, then retires it on prompt refusal without
// ever reading agent_status.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

test("a refused continue prompt does not retire a resumed pane that is still working", () => {
  process.env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  process.env.AGENTIC_OS_BRIEF_TRIES = "1"
  process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = "0"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  const dir = mkdtempSync(join(tmpdir(), "principles-resume-"))
  const brief = join(dir, "continue.md")
  writeFileSync(brief, "pick up exactly where you left off\n")
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
        return { status: 0, stdout: "", stderr: "" }
      },
    } as never,
    shepRunner: (args: string[]) => {
      if (args[0] === "retire") retired.push(args.join(" "))
      return { status: 0, stdout: "" }
    },
  })
  // resumeWorker's own call shape: hold=false even though a session is resumed
  rail.inhabitPane("w-france", "opencode", "p-1", brief, dir, undefined, undefined, false, "ses-prior")
  const statusReads = calls.filter((c) => c[0] === "agent" && c[1] === "get")
  assert.equal(
    retired.length,
    0,
    `INV-1: a refused continue prompt retired the resumed pane (${retired.join("; ") || "none"}) after a fixed brief-retry sleep; agent_status was still working and was never observed (status reads=${statusReads.length}) — coworker resume holds, so this death is the fan-out twin left wrong`,
  )
})
