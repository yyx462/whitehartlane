import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m103-home-"))

import test from "node:test"
import { benchOrder, cycle, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { readCheckpoints, readState } from "../../src/core/state.ts"

// BASE shape: the birth judge is this diff's own addition. No birth seat
// on BASE → nothing to judge (the momentum-14 device: vacuous green on
// BASE, so the prove gate classifies this repro as introduced).
if (!benchOrder({ faults: true }).includes("birth")) {
  test("skipped on BASE: the birth judge does not exist there", () => {})
} else {
  // A pane that spawns fine and NEVER boards: no session, no log, and
  // a status that is not "working" (the j-4a0009 transport class).
  function unboardedPort() {
    const spawned: string[] = []
    const retired: string[] = []
    const p: ShepPort = {
      setLayout: () => {},
      spawnWorker: (name) => {
        spawned.push(name)
        return true
      },
      paneAlive: () => true,
      workerStatus: () => "unknown", // never "working": no defers anywhere
      reprompt: () => true,
      retire: (name) => retired.push(String(name)),
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    }
    return { port: p, spawned, retired }
  }

  function fixtureUnits(where: string): void {
    cpSync(join(import.meta.dirname, "..", "fixtures", "three-lookups"), where, { recursive: true })
  }

  // CONTROL: with the declared order right (born_ms < stall_ms — the
  // shipped pr-review template's shape), the birth judge owns the
  // never-boarding pane's death: it rules at born_ms and the close is
  // transport class. This proves the harness sees the right owner when
  // the ordering permits it.
  test("control: born_ms < stall_ms — the birth judge rules and the close is a fault, never an answer", () => {
    const units = mkdtempSync(join(tmpdir(), "whl-m103-ctl-"))
    try {
      fixtureUnits(units)
      const { port: fake } = unboardedPort()
      const events: { kind: string; payload: Record<string, unknown> }[] = []
      let clock = 0
      const deps: CycleDeps = {
        taskDir: units,
        hooks: hooksFromDir(units).hooks,
        shep: fake,
        inFlight: new Map(),
        attempts: new Map(),
        slots: 1, // only france is ever in flight
        stallMs: 180_000,
        bornMs: 60_000,
        briefGraceMs: 90_000,
        now: () => clock,
        emit: (kind, payload) => events.push({ kind, payload }),
        faults: {
          sessionOf: () => undefined, // never boards
          rebook: () => undefined,
          cwdOf: () => units,
          workerStatus: () => "unknown",
          latestSessionFault: () => null,
          switchSessionModel: () => {},
          promptAgent: () => true,
        },
      }
      cycle(deps) // t=0: france spawns
      clock = 60_001 // past born_ms (60s), inside stall_ms (180s)
      cycle(deps)

      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.deepEqual(
        reborn,
        ["france"],
        `premise: with born_ms < stall_ms the birth judge rules at born_ms (unit.reborn events: ${JSON.stringify(events)})`,
      )
      const cards = readCheckpoints(units).filter((c) => c.unit === "france" && c.status !== "info")
      assert.deepEqual(
        cards,
        [],
        `control: the pane is inside its birth window ownership — no answer card may exist (cards: ${JSON.stringify(cards)})`,
      )
    } finally {
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
    }
  })

  // THE LAW: the never-boarding pane's death is TRANSPORT — the birth
  // judge's own doctrine ("transport, never an answer … never trips the
  // canary", #144). But the birth seat answers only when it is REACHED:
  // the stall seat sits AFTER it in benchOrder, so whenever
  // stall_ms < born_ms — legal today (workflow.stall_ms validates from
  // 60s, workflow.born_ms up to 600s, and the born DEFAULT is 180s, so
  // every stall_ms in [60s, 180s) hits it with NO born_ms declared) —
  // the stall judge answers the birth question FIRST: "no log output
  // for 60s", an ANSWER close with the default faultsCanary=true /
  // fault=false. The transport death settles as a plain FAILED answer
  // card (regrade cannot re-enter) and trips the canary — the run then
  // reports "canary-stopped", the label reserved for "a REAL answer
  // failed", with no answer anywhere on the path. The identical pane
  // under the identical silence closes transport-class the moment the
  // declared order flips (the control above): one decision — "what is a
  // never-boarding pane's death" — answered two opposite ways by two
  // seats, and the diff aligned FIVE other closes to the transport
  // answer while leaving this path on the old one.
  test("an unboarded pane closed by the stall seat settles transport-class, never as a canary-tripping answer", () => {
    const units = mkdtempSync(join(tmpdir(), "whl-m103-run-"))
    try {
      fixtureUnits(units)
      const { port: fake } = unboardedPort()
      const events: { kind: string; payload: Record<string, unknown> }[] = []
      const canary = { enabled: true, released: false, failed: false }
      let clock = 0
      const deps: CycleDeps = {
        taskDir: units,
        hooks: hooksFromDir(units).hooks,
        shep: fake,
        inFlight: new Map(),
        attempts: new Map(),
        slots: 3,
        stallMs: 60_000, // legal floor; BELOW born_ms — the overlap region
        bornMs: 180_000, // the shipped DEFAULT (DEFAULT_BORN_MS)
        briefGraceMs: 90_000,
        now: () => clock,
        canary,
        emit: (kind, payload) => events.push({ kind, payload }),
        faults: {
          sessionOf: () => undefined, // never boards — the j-4a0009 class
          rebook: () => undefined,
          cwdOf: () => units,
          workerStatus: () => "unknown",
          latestSessionFault: () => null,
          switchSessionModel: () => {},
          promptAgent: () => true,
        },
      }
      cycle(deps) // t=0: france spawns, never boards
      clock = 60_001 // the stall beat; still INSIDE the birth window (180s)
      cycle(deps)

      // ADAPTED AT ADOPTION (gate-r30, the momentum-34 r19 precedent):
      // the original premise pinned the DISEASE — the stall seat
      // closing france here with an answer card. The fix carries an
      // unboarded pane inside the birth window; the birth seat owns
      // the death. The end-to-end law — a never-boarding pane's death
      // is never an answer card, never canary-tripping, on either
      // clock ordering — untouched.
      const earlyClose = events.filter((e) => e.kind === "unit.finished" && e.payload.unit === "france")
      assert.deepEqual(
        earlyClose,
        [],
        `the stall seat no longer answers a never-boarding pane's death inside the birth window (unit.finished events: ${JSON.stringify(earlyClose)})`,
      )

      clock = 180_001 // the birth beat — the birth seat rules, whatever stall_ms says
      // the grace judge's one reprompt outranks birth on the bench for a
      // beat; cycle until the birth seat actually sits
      for (let i = 0; i < 6 && !events.some((e) => e.kind === "unit.reborn"); i++) {
        clock += 1_000
        cycle(deps)
      }

      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.deepEqual(
        reborn,
        ["france"],
        `the birth judge owns the never-boarding pane's death on BOTH orderings — rebirth, transport class (events: ${JSON.stringify(events.filter((e) => e.kind === "unit.reborn" || e.kind === "unit.finished"))})`,
      )

      // THE CARD: a transport death lands as a grade-fault card
      // (regrade re-enters), never a plain FAILED answer card — and at
      // this beat (one rebirth, cap unspent) NO card exists at all.
      const cards = readCheckpoints(units).filter((c) => c.unit === "france" && c.status !== "info")
      assert.equal(
        cards.length,
        0,
        `INV-4/INV-3: "what is a never-boarding pane's death?" is answered ONE way — the birth seat's transport ruling (grade-fault at the cap, rebirth before it). The stall seat used to answer first whenever stall_ms < born_ms — legal config; the born DEFAULT alone is 180s, so every stall_ms in [60s, 180s) hit it — closing the pane "no log output for 60000ms" as a plain FAILED answer card with faultsCanary=true: 'canary-stopped' on a path where no answer exists. Cards: ${JSON.stringify(cards)}`,
      )

      // THE LABEL: infra never trips the stop-the-line canary.
      assert.equal(
        canary.failed,
        false,
        `INV-4: the never-boarding path tripped canary.failed (canary state: ${JSON.stringify(canary)}) — the run would report "canary-stopped", the label reserved for "a REAL answer failed" (#144), on a path where no answer exists: the pane never boarded, no worker ever spoke.`,
      )
    } finally {
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
    }
  })
}
