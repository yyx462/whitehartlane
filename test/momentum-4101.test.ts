// momentum-4101 — the close ceremony must survive a THROWING usage probe.
//
// The diff puts the new per-unit cost probe INSIDE the orchestrator's
// one close ceremony (src/engines/orchestrator.ts, finish()):
//
//     if (!deps.worktree) {
//       const usage = deps.usageOf?.(id, 0)      // <-- unguarded
//       if (usage) deps.emit?.("unit.tokens", { unit: id, ...usage })
//     }
//
// finish() is called from applyRuling's "close" arm, and the close arm
// is the ceremony that retires the pane, drops the unit from the
// flight map and wakes the levy:
//
//     finish(id, ruling.pass, ...)      // the probe runs HERE
//     deps.shep.retire(`w-${id}`)       // ...never reached on a throw
//     deps.inFlight.delete(id)          // ...never reached on a throw
//     if (ruling.wake !== undefined) deps.shep.wake(id, "blocked", ruling.wake)
//
// The port's own law says the read is best-effort ("no host store, no
// row, never a gate" — src/ports/agent-host.ts), and every other
// best-effort seam in this repo is wrapped (the rail's ledger emit is
// try/caught; the board's tokensOf is try/caught). Here a host whose
// usage store throws takes the whole ceremony down with it: the settle
// card is written (settle() runs BEFORE the probe), the pane is never
// retired, the unit never leaves the flight map, the levy is never
// woken, and the exception escapes cycle() into the orchestrator's
// tick (runOrchestrator's run() has no catch) — the run dies on an
// accounting probe.
//
// The host is a PLUGIN seam (ports/agent-host.ts: "a future host
// plugin implements THIS interface"), so a throwing store is a
// reachable edge, not a fiction.
//
// If the probe were removed (the pre-change behaviour), this test
// PASSES: the guard is the behavior, and nothing holds it today.
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the settle card rides the OS-disk trace — keep the operator's home out
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-mom4101-home-"))

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
    wake: (name, _kind, why) => woken.push(`${name}:${why}`),
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, retired, woken }
}

test("a throwing usage store cannot abort the unit's close ceremony", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-mom4101-"))
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
    // the fault: the host's own usage store is unreadable
    usageOf: () => {
      throw new Error("host usage store exploded")
    },
  }

  cycle(deps)
  phase = "idle"
  mkdirSync(join(dir, "units", "demo"), { recursive: true })
  writeFileSync(join(dir, "units", "demo", "result.md"), "Paris\n")

  assert.doesNotThrow(
    () => cycle(deps),
    "a best-effort usage probe must never escape the settle ceremony",
  )
  assert.equal(
    inFlight.has("demo"),
    false,
    "the settled unit left the flight map (the close ceremony ran to the end)",
  )
  assert.deepEqual(
    shep.retired,
    ["w-demo"],
    "the settled unit's pane was retired (the close ceremony ran to the end)",
  )
})
