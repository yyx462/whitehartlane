import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, appendFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-t500-"))

import { runOrchestrator, type ShepPort } from "../../src/engines/orchestrator.ts"

// Meta-ACH: the reverted-half / status-blind shape. The diff's own
// template law (templates/pr-review/workflow.toml, born_ms comment):
// "a pane that never BOARDS (no agent session) is transport class, not
// silence — kill + respawn within minutes, never ride the 30-min
// ceiling". The birth judge's own doctrine agrees: "Session existence
// is the only key; log quietness is NOT evidence." But the judge then
// carves out `if (b.paneStatus === "working") return none // boarding
// right now` (orchestrator.ts birthJudge) — a SECOND key that trusts
// the very transport it was written to distrust — and the STALL judge
// defers working panes too (`if (b.paneStatus === "working") return
// defer "agent working"`, resetting lastChange every cycle). A pane
// whose agent never mints a session while herdr reports
// agent_status:"working" — the j-4a0009 shape (the pane lived its
// whole life behind a modal INSIDE a running agent; a prompt was
// submitted, so the multiplexer says working) — is therefore judged by
// NEITHER ladder: no reborn at born_ms, no stall close ever (each
// defer resets the stall clock). The run rides its whole deadline with
// a pane that boarded nothing — the exact ceiling born_ms exists to
// cut, and the run's wall-time bill with it.
//
// Deterministic, real timers (the judges + the deadline are the code
// under judgment): bornMs=300, stallMs=2500, deadlineMs=4000. If the
// born deadline judges this pane, the first unit.reborn lands ~300ms
// (and the respawn settles the run). As shipped, no unit.reborn ever
// fires — the deadline settles the unit failed at 4s.
test("an unboarded pane herdr reports working is still judged at born_ms — never boarded is transport class regardless of status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-t500-run-"))
  try {
    mkdirSync(join(dir, "units"), { recursive: true })
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "t500"`,
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
    const DEADLINE_MS = 4_000
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
          // after the birth-judge respawn, settle the run quickly —
          // the assertion point (the FIRST unit.reborn) is already past
          appendFileSync(logPath, "done france\n")
        }
        return true
      },
      paneAlive: () => true,
      // THE SHAPE UNDER JUDGMENT: the multiplexer's agent_status says
      // "working" (a prompt was submitted; the agent process is alive)
      // while the agent NEVER mints a session (sessionOf stays
      // undefined — the j-4a0009 modal/transport class)
      workerStatus: () => "working",
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
        deadlineMs: DEADLINE_MS,
        emit: (kind) => events.push({ kind, at: Date.now() - t0 }),
        faults: {
          sessionOf: () => undefined, // the agent NEVER boards
          rebook: () => undefined, // the second look finds nothing either
          cwdOf: () => dir,
          workerStatus: () => "working",
          latestSessionFault: () => null,
          switchSessionModel: () => ({}),
          promptAgent: () => ({}),
        },
      })
    } finally {
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }

    const first = events.find((e) => e.kind === "unit.reborn")
    assert.ok(
      first,
      `the birth judge never ruled for a pane that NEVER boarded: no unit.reborn event in ` +
        `[${events.map((e) => e.kind).join(", ")}] — the pane rode the run's whole ${DEADLINE_MS}ms deadline. ` +
        `INV-3/INV-4: "may an unboarded pane escape born_ms by reporting working?" is answered YES twice in ` +
        `src/engines/orchestrator.ts — birthJudge ("if (b.paneStatus === 'working') return none // boarding ` +
        `right now") and stallJudge ("if (b.paneStatus === 'working') return defer 'agent working'", which ` +
        `resets flight.lastChange every cycle). The diff's own law says otherwise twice: the born_ms comment ` +
        `("a pane that never BOARDS (no agent session) is transport class, not silence — kill + respawn within ` +
        `minutes, never ride the 30-min ceiling") and the birth judge's own doctrine ("Session existence is the ` +
        `only key; log quietness is NOT evidence"). The j-4a0009 pane lived its whole life behind a modal INSIDE ` +
        `a running agent — herdr agent_status:'working' (a prompt was submitted) while no session was ever ` +
        `minted. For that pane BOTH ladders stand down: no reborn at born_ms, no stall close ever (each defer ` +
        `resets the clock), and the run rides its full deadline — the exact ceiling born_ms exists to cut. ` +
        `Judge on session existence alone: drop the working exemption from birthJudge (status "working" is ` +
        `exactly what a wedged pre-session agent reports), or bound it (working spares the pane only until ` +
        `bornMs; past bornMs the missing session decides).`,
    )
    assert.ok(
      first && first.at <= BORN_MS + 1_500,
      `the birth judge ruled at ${first?.at}ms — not at the born deadline (${BORN_MS}ms): the pane's working ` +
        `status bought it a ride past born_ms before any judgment landed`,
    )
    assert.ok(
      spawns >= 2,
      "sanity: the rebirth respawned the unit (the judge did not only close it)",
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
