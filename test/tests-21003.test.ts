// tests-21003 — the MID-FAILURE fault: a host usage store that throws
// must not break the settle ceremony.
//
// The diff puts a best-effort probe INSIDE finish() (the one place a
// unit's cost is final):
//
//     if (!deps.worktree) {
//       const usage = deps.usageOf?.(id, 0)
//       if (usage) deps.emit?.("unit.tokens", { unit: id, ...usage })
//     }
//
// but the call is UNGUARDED, and finish() is called from applyRuling
// (orchestrator.ts) — the ONE ceremony per ruling:
//
//     finish(id, ruling.pass, ...)
//     deps.shep.retire(`w-${id}`)      <-- never reached
//     deps.inFlight.delete(id)         <-- never reached
//     deps.attempts.delete(id)         <-- never reached
//     if (ruling.wake !== undefined) deps.shep.wake(id, "blocked", ruling.wake)  <-- never reached
//
// The port's own law (src/ports/agent-host.ts) says the usage read is
// "Best-effort by law: no host store, no row, never a gate"; every
// other best-effort seam in the rail is wrapped (the ledger's emit is
// try/caught; the board's tokensOf is try/caught). Here an exception
// escapes cycle() with the unit still in flight and its pane never
// retired — the run hangs until the deadline, and the levy is never
// woken.
//
// If the implementation were reverted (the probe removed), this test
// PASSES — which is exactly the point: the guard is the behavior, and
// nothing in the repo currently holds it.

import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const { hooksFromDir } = await import("../src/doors/hooks.ts")
const { cycle } = await import("../src/engines/orchestrator.ts")
import type { CycleDeps, ShepPort } from "../src/engines/orchestrator.ts"

const ROOT = join(import.meta.dirname, "..")

function fakeShep(status: () => "working" | "idle" | "blocked" | "unknown") {
  const retired: string[] = []
  const woken: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    workerStatus: status,
    reprompt: () => true,
    retire: (name) => retired.push(name),
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: (name) => woken.push(name),
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, retired, woken }
}

test("a host usage store that throws never breaks the settle ceremony", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-t21003-"))
  cpSync(join(ROOT, "test", "fixtures", "three-lookups"), dir, { recursive: true })
  writeFileSync(
    join(dir, "units.jsonl"),
    `${JSON.stringify({ id: "demo", brief: "Produce the deliverable named in the closing contract." })}\n`,
  )
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const inFlight = new Map()
  const attempts = new Map()
  const deps: CycleDeps = {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: shep.port,
    inFlight,
    attempts,
    slots: 3,
    settleMode: "status-first",
    fallbackLadder: false,
    emit: () => {},
    // the fault: the host's usage store is unreadable
    usageOf: () => {
      throw new Error("host usage store exploded")
    },
  }

  cycle(deps)
  phase = "idle"
  mkdirSync(join(dir, "units", "demo"), { recursive: true })
  writeFileSync(join(dir, "units", "demo", "result.md"), "Paris\n")

  // the ceremony must survive the probe
  assert.doesNotThrow(() => cycle(deps), "a best-effort usage probe must never escape the settle ceremony")
  assert.equal(
    inFlight.has("demo"),
    false,
    "the settled unit left the flight map (the close ceremony ran)",
  )
  assert.deepEqual(
    shep.retired,
    ["w-demo"],
    "the settled unit's pane was retired (the close ceremony ran)",
  )
})
