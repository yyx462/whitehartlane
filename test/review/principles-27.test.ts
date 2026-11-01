import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the unit ledger rides the OS-disk trace — pin a private home (the repo's
// own repro convention) before anything reads it
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p27-home-"))

import test from "node:test"
import { benchOrder, runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

// BASE shape: the birth judge is this diff's own addition (benchOrder gains
// the "birth" seat here). No birth seat on BASE → nothing to judge (the
// momentum-14 device: vacuous green on BASE, so the prove gate classifies
// this repro as introduced).
if (!benchOrder({ faults: true }).includes("birth")) {
  test("skipped on BASE: the birth judge does not exist there", () => {})
} else {
  // INV-3 (one decision, one place — "when does the rail wake to judge an
  // unboarded pane") / INV-4 (the change's own claim is honest).
  //
  // The diff seats a birth judge whose patience is born_ms ("a pane that
  // never BOARDS ... kill + respawn within minutes, never ride the 30-min
  // ceiling", templates/pr-review/workflow.toml; ECONOMICS.md proposal 3:
  // "with a born-check it dies in ~3"). The judge itself OBSERVES session
  // existence (INV-1-clean) — but a judge is only as fast as the wake that
  // drives it, and the run loop's ONE wake computer — arm()
  // (src/engines/orchestrator.ts) — was never taught born_ms: its waits are
  // the deadline, the drain ceiling, the brief-grace window, and
  // lastChange + stallMs. Nothing else wakes the loop for a pane whose
  // agent never boarded: no log growth (the worker protocol's log is
  // written by the agent), waitWorker resolves only on done/blocked, and
  // the spawn-retry timer only exists AFTER a first rebirth. So on the
  // production template (born_ms = 300000, stall_ms = 1800000) the FIRST
  // birth-judge look lands at the ~30-minute stall wake — the exact
  // ceiling born_ms promises to never ride — and the rebirth ladder then
  // spends up to RETRY_CAP stalls (~90 min) closing a unit the stall
  // ladder alone used to close in one (~30 min, BASE). The cycle-level
  // tests adopted with this diff drive the bench with an injected clock
  // and never arm a timer, so the starvation is invisible to them.
  //
  // Deterministic: the real runOrchestrator loop (real timers — the arm()
  // decision is the code under judgment), a fake shep whose worker writes
  // one non-marker log line at spawn (so the brief-grace lane cannot fire
  // and cannot be blamed), bornMs 3s, stallMs 8s. If the born deadline is
  // armed, the first unit.reborn lands ~bornMs; as shipped it lands at the
  // stall wake (~stallMs). The assertion names the gap.
  test("an unboarded pane's birth-judge kill lands at born_ms — the run loop arms the born deadline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "whl-p27-run-"))
    mkdirSync(join(dir, "units"), { recursive: true })
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "p27"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "france", brief = "work here" },`,
        `]`,
        "",
      ].join("\n"),
    )

    const BORN_MS = 3_000
    const STALL_MS = 8_000
    const logPath = join(dir, "units", "france", "log.txt")
    let spawns = 0
    const shep: ShepPort = {
      setLayout: () => {},
      spawnWorker: (_name, _kind, _briefPath) => {
        spawns += 1
        // the worker protocol's first breath — a line that is NOT a marker.
        // Written synchronously at spawn so the brief-grace judge (which
        // seats before birth) has nothing to do in this repro.
        writeFileSync(logPath, "starting\n")
        if (spawns === 2) {
          // after the first rebirth's respawn: end the run quickly with the
          // worker's own pen (written AFTER the respawn's log write, so it
          // survives) — the assertion point has already passed by then
          appendFileSync(logPath, "done france\n")
        }
        return true
      },
      paneAlive: () => true,
      workerStatus: () => "unknown", // never working, never idle-done
      reprompt: () => true,
      retire: () => {},
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
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
          switchSessionModel: () => {},
          promptAgent: () => true,
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    }

    const first = events.find((e) => e.kind === "unit.reborn")
    assert.ok(first, "sanity: the birth judge eventually rules — a unit.reborn event fires")
    assert.equal(
      spawns >= 2,
      true,
      "sanity: the rebirth respawned the unit (the judge did not only close it)",
    )
    assert.ok(
      first.at <= BORN_MS + 2_000,
      `INV-3 (one decision, one place) / INV-4 (the change's own claim is false): the birth judge's patience ` +
        `is born_ms — the template's own words are "kill + respawn within minutes, never ride the 30-min ceiling" ` +
        `and ECONOMICS.md promises "with a born-check it dies in ~3" — but the run loop's wake computer arm() ` +
        `(src/engines/orchestrator.ts) computes its waits from the deadline, the drain ceiling, brief grace, and ` +
        `lastChange + stallMs ONLY: the born deadline is never armed. A pane whose agent never boards produces ` +
        `no log growth and no done/blocked pane event, so the FIRST birth-judge look lands at the stall wake — ` +
        `observed here at ${first.at}ms after spawn with bornMs=${BORN_MS} and stallMs=${STALL_MS} (the stall ` +
        `ceiling, not born_ms). On the shipped pr-review template (born_ms=300000, stall_ms=1800000) that is a ` +
        `~30-minute first kill — the exact j-4a0009 ceiling ride born_ms exists to prevent — and the rebirth ` +
        `ladder then spends up to RETRY_CAP=3 stalls (~90 min) closing a unit BASE's stall ladder closed in one. ` +
        `The judge observes the right state (INV-1-clean); the WAKE that drives it still rides the timer the ` +
        `diff promised to stop riding. Arm the born deadline in arm() (a pane with no session re-arms at ` +
        `spawnedAt + bornMs) or wake the loop on the same observed state.`,
    )
  })
}
