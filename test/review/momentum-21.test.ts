import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, appendFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m21-"))

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

// MOMENTUM (timing/lifecycle): the birth judge's patience (born_ms) is
// a DEADLINE THE RUN LOOP NEVER ARMS. The judge itself is correct —
// cycle() rules at age > bornMs and the unit tests pin that with an
// injected clock — but cycle() only RUNS when the loop wakes, and the
// wake computer arm() (src/engines/orchestrator.ts, `const arm`) fills
// its wait list from: the run deadline, the drain ceiling, brief grace
// (logPath missing && !reprompted), flight.lastChange + stallMs, and
// gateCheckMs. spawnedAt + bornMs is NOWHERE in the list. A pane whose
// agent never boards writes nothing and fires no pane event, so after
// the grace beat the loop sleeps until the STALL wake — and only then
// does the birth judge get its first look.
//
// The ordering only holds on the happy path: any other judge that
// rules (a marker, a stall, a pen close) wakes the loop before born_ms
// only by luck of a shorter timer. On the shipped pr-review template
// (born_ms = 300_000, stall_ms = 1_800_000) the FIRST dead-at-birth
// kill lands at ~30 min — the exact j-4a0009 ceiling ride born_ms was
// written to end — and the rebirth ladder then spends up to
// RETRY_CAP=3 stalls (~90 min) closing a unit BASE's stall ladder
// closed in one. The template's own words promise "kill + respawn
// within minutes, never ride the 30-min ceiling".
//
// Deterministic ratio, real timers (arm() IS the code under judgment):
// bornMs=300, stallMs=2500. If the born deadline is armed, the first
// unit.reborn lands ~300ms; as shipped it lands at the stall wake
// (~2500ms). The assertion cuts between them with >1.4s of headroom.
test("the run loop wakes for the born deadline — an unboarded pane is judged at born_ms, not at the stall wake", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-m21-run-"))
  try {
    mkdirSync(join(dir, "units"), { recursive: true })
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "m21"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "solo"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "france", brief = "work here" },`,
        `]`,
        "",
      ].join("\n"),
    )

    const BORN_MS = 300
    const STALL_MS = 2_500
    const logPath = join(dir, "units", "france", "log.txt")
    let spawns = 0
    const shep: ShepPort = {
      setLayout: () => {},
      spawnWorker: (_name, _kind, _briefPath) => {
        spawns += 1
        // the worker protocol's first breath — a NON-marker line at
        // spawn, so the brief-grace lane (seated before birth) has
        // nothing to do and cannot be blamed for the wake
        writeFileSync(logPath, "starting\n")
        if (spawns === 2) {
          // after the rebirth respawn, settle the run quickly — the
          // assertion point (the FIRST unit.reborn) is already past
          appendFileSync(logPath, "done france\n")
        }
        return true
      },
      paneAlive: () => true,
      workerStatus: () => "unknown",
      reprompt: () => true,
      retire: () => {},
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set(), capped: new Set() }),
    }

    const events: { kind: string; at: number }[] = []
    const t0 = Date.now()
    try {
      await runOrchestrator({
        taskDir: dir,
        shep,
        trapSignals: false,
        bornMs: BORN_MS,
        stallMs: STALL_MS,
        emit: (kind) => events.push({ kind, at: Date.now() - t0 }),
        faults: {
          sessionOf: () => undefined, // the agent NEVER boards
          rebook: () => undefined, // the second look finds nothing either
          cwdOf: () => dir,
          workerStatus: () => "unknown",
          latestSessionFault: () => null,
          switchSessionModel: () => ({}),
          promptAgent: () => ({}),
        },
      })
    } finally {
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }

    const first = events.find((e) => e.kind === "unit.reborn")
    assert.ok(first, "sanity: the birth judge eventually rules — a unit.reborn event fires")
    assert.ok(
      spawns >= 2,
      "sanity: the rebirth respawned the unit (the judge did not only close it)",
    )
    assert.ok(
      first.at <= BORN_MS + 1_500,
      `MOMENTUM (a deadline the wake computer never arms — the wait rides the timer born_ms replaced): the ` +
        `birth judge ruled at ${first.at}ms after spawn with bornMs=${BORN_MS} and stallMs=${STALL_MS} — the ` +
        `stall wake, not the born deadline. The run loop's wake computer arm() (src/engines/orchestrator.ts, ` +
        `\`const arm\`) fills its wait list from the run deadline, the drain ceiling, brief grace, ` +
        `lastChange + stallMs, and gateCheckMs — spawnedAt + bornMs is nowhere in it. A pane that never ` +
        `boards writes no log and fires no pane event, so the first birth-judge look lands at the stall ` +
        `ceiling: on the shipped pr-review template (born_ms=300000, stall_ms=1800000) that is a ~30-minute ` +
        `first kill — the exact j-4a0009 ceiling ride born_ms exists to prevent — and RETRY_CAP=3 rebirths ` +
        `then spend ~90 min where BASE's stall ladder closed the unit in one. The cycle()-level logic is ` +
        `right (the injected-clock tests pin it); the LOOP never wakes in time. Arm the born deadline in ` +
        `arm() (a flight with no session re-arms at spawnedAt + bornMs) or wake on the same observed state.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
