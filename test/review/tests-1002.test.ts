import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests1002-"))

import { stageRun } from "../../src/doors/run.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { cycle, unitPaths, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { readState, readCheckpoints } from "../../src/core/state.ts"

const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// BASE shape: the birth judge does not exist there — every scenario in
// this file is vacuous on BASE (the momentum-26 device: guarded on the
// marker this diff introduced)
const HEAD_HAS_BIRTH_JUDGE = readFileSync(join(import.meta.dirname, "..", "..", "src", "engines", "orchestrator.ts"), "utf8").includes("const birthJudge")

// a port whose panes NEVER board: spawnWorker succeeds (a live pane
// exists) but no agent session is ever booked — the j-4a0009
// dead-at-birth shape the diff's birth judge exists to kill
function port() {
  const spawned: string[] = []
  const retired: string[] = []
  const p: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name) => {
      spawned.push(name)
      return true
    },
    paneAlive: () => true,
    workerStatus: () => "unknown",
    reprompt: () => true,
    retire: (name) => {
      retired.push(String(name))
    },
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port: p, spawned, retired }
}

function faultsFor(dir: string) {
  // sessions never resolve, the one rebook never lands — the pane is
  // unboarded forever, which is the judge's whole premise
  return {
    sessionOf: () => undefined,
    rebook: () => undefined,
    cwdOf: () => dir,
    workerStatus: () => "unknown",
    latestSessionFault: () => null,
    switchSessionModel: () => ({ ok: true }),
    promptAgent: () => true,
  }
}

function depsFor(dir: string, shep: ShepPort, extra: Partial<CycleDeps> = {}): CycleDeps {
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    log: () => {},
    faults: faultsFor(dir) as CycleDeps["faults"],
    // bornMs -1: the birth window is already over at every observation
    // (a deps-level override; the manifest's floor of 30s does not bind
    // the CycleDeps seam) — deterministic, no timers
    bornMs: -1,
    ...extra,
  } as CycleDeps
}

// the birth judge's whole arc: an unboarded pane is rebirthed (retire
// + respawn) until the RETRY_CAP, then CLOSED as "dead at birth" — the
// unit settles failed, no pane outlives the cap, and every retire
// speaks the pane's spawn label (`w-<id>`).
test("an unboarded pane is rebirthed to the cap, then closed dead at birth", () => {
  if (!HEAD_HAS_BIRTH_JUDGE) return // BASE: no birth judge — nothing to judge
  const source = mkdtempSync(join(tmpdir(), "whl-t1002-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), "whl-t1002-run-"))
  try {
    stageRun(source, dir)
    const one = port()
    const events: [string, Record<string, unknown>][] = []
    const d = depsFor(dir, one.port, { emit: (kind, payload) => events.push([kind, payload]) })

    cycle(d) // 1: spawn all three
    assert.equal(one.spawned.length, 3, "sanity: the first cycle spawns all three units")
    cycle(d) // 2: birth judge — rebirth #1 each
    cycle(d) // 3: rebirth #2 each
    cycle(d) // 4: cap reached (RETRY_CAP 3) — close "dead at birth"
    cycle(d) // 5: nothing left to spawn

    const state = readState(dir)
    assert.deepEqual(
      [...state.failed].sort(),
      ["france", "japan", "peru"],
      `the unboarded panes must close dead at birth at the cap; state: ${JSON.stringify(state)}`,
    )
    assert.equal(one.spawned.length, 9, `3 spawns + 2 rebirth respawns each — no respawn after the close (got ${one.spawned.length})`)
    assert.ok(
      one.retired.length > 0 && one.retired.every((l) => /^w-[a-z]/.test(l)),
      `every retire speaks the pane's spawn label w-<id>; got ${JSON.stringify(one.retired)}`,
    )
    const reborn = events.filter(([k]) => k === "unit.reborn")
    assert.equal(reborn.length, 6, `two rebirth events per unit (got ${reborn.length}: ${JSON.stringify(events.map((e) => e[0]))})`)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

// INV-1's drain twin: the birth judge must stay unseated while the run
// drains — a stop path never kills panes for birth failure (the drain
// waits on observed not-working state instead).
test("draining unseats the birth judge — no rebirth, no retire, no settle", () => {
  if (!HEAD_HAS_BIRTH_JUDGE) return // BASE: no birth judge — nothing to judge
  const source = mkdtempSync(join(tmpdir(), "whl-t1002d-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), "whl-t1002d-run-"))
  try {
    stageRun(source, dir)
    const one = port()
    const events: [string, Record<string, unknown>][] = []
    // pre-seed one unboarded flight (no draining cycle would ever spawn)
    const paths = unitPaths(dir, "france")
    mkdirSync(paths.dir, { recursive: true })
    writeFileSync(paths.briefPath, "brief\n")
    const d = depsFor(dir, one.port, {
      draining: true,
      emit: (kind, payload) => events.push([kind, payload]),
    })
    ;(d.inFlight as Map<string, unknown>).set("france", {
      unit: { id: "france", brief: "b" },
      logPath: paths.logPath,
      briefPath: paths.briefPath,
      lastSize: 0,
      lastChange: Date.now(),
      spawnedAt: Date.now(),
      reprompted: false,
      worktree: paths.dir,
      settleAttempts: 0,
      workedSinceAttempt: false,
    })

    cycle(d)
    assert.equal(one.retired.length, 0, `a drain must not retire the unboarded pane (got ${JSON.stringify(one.retired)})`)
    assert.equal(
      events.filter(([k]) => k === "unit.reborn").length,
      0,
      "a drain must not fire the birth judge's rebirth",
    )
    const state = readState(dir)
    assert.ok(
      !state.failed.includes("france") && !state.done.includes("france"),
      `a drain must not settle the pane; state: ${JSON.stringify(state)}`,
    )

    // control: the SAME pre-seeded flight, NOT draining — the judge
    // fires (proving the pre-seed is judged and the drain guard is
    // what suppressed it)
    const two = port()
    const d2 = depsFor(dir, two.port)
    ;(d2.inFlight as Map<string, unknown>).set("france", {
      unit: { id: "france", brief: "b" },
      logPath: paths.logPath,
      briefPath: paths.briefPath,
      lastSize: 0,
      lastChange: Date.now(),
      spawnedAt: Date.now(),
      reprompted: false,
      worktree: paths.dir,
      settleAttempts: 0,
      workedSinceAttempt: false,
    })
    cycle(d2)
    assert.ok(
      two.retired.includes("w-france"),
      `control: without draining the birth judge rebirths the same flight (retired: ${JSON.stringify(two.retired)})`,
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

// INV-4 (verdicts are honest — an infra failure is never reported as
// an answer): the judge's own doctrine calls the never-boarded pane
// "transport class" — but its close ruling carries no `fault` mark, so
// applyRuling settles fault=false → the card reads FAILED (an answer:
// "the unit's work failed") instead of grade-fault (infra).
test("a dead-at-birth close lands as a fault, never as an answer", () => {
  if (!HEAD_HAS_BIRTH_JUDGE) return // BASE: no birth judge — nothing to judge
  const source = mkdtempSync(join(tmpdir(), "whl-t1002f-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), "whl-t1002f-run-"))
  try {
    stageRun(source, dir)
    const one = port()
    const d = depsFor(dir, one.port, { slots: 1 })

    cycle(d) // spawn france (slots 1)
    cycle(d) // rebirth #1
    cycle(d) // rebirth #2
    cycle(d) // cap — close "dead at birth"

    const cards = readCheckpoints(dir).filter((c) => c.unit === "france" && c.status !== "info")
    assert.ok(cards.length > 0, "sanity: france has a settle card")
    const card = cards[cards.length - 1]
    assert.equal(
      card.status,
      "grade-fault",
      `INV-4: the birth judge's own doctrine calls the never-boarded pane "transport class" — its close must ` +
        `settle as a FAULT (card status "grade-fault"), never as an answer ("FAILED"). The ruling carries no ` +
        `fault mark, so applyRuling defaults it to false. Card: ${JSON.stringify(card)}`,
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

// the twin half of the same mis-marked close: faultsCanary defaults
// true, so the transport death TRIPS THE CANARY — finish()'s own law:
// "a grade-FAULT (infra, not answer) never trips the canary: the
// stop-the-line gate exists to protect slots from a doomed PLAN". One
// pane that never boards (the #249 transport class) stops the plan's
// remaining units from ever spawning.
test("a dead-at-birth close must not trip the canary — transport does not doom the plan", () => {
  if (!HEAD_HAS_BIRTH_JUDGE) return // BASE: no birth judge — nothing to judge
  const source = mkdtempSync(join(tmpdir(), "whl-t1002g-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), "whl-t1002g-run-"))
  try {
    stageRun(source, dir)
    const one = port()
    const d = depsFor(dir, one.port, {
      slots: 1,
      canary: { enabled: true } as CycleDeps["canary"],
    })

    cycle(d) // spawn france (slots 1)
    cycle(d) // rebirth #1
    cycle(d) // rebirth #2
    cycle(d) // cap — close "dead at birth"
    cycle(d) // the cycle after the transport death

    assert.ok(
      one.spawned.includes("w-japan"),
      `a transport death must not stop the line: the canary tripped on a dead-at-birth close ` +
        `(faultsCanary defaults true), so the plan's remaining units never spawn — ` +
        `finish()'s own law: "a grade-FAULT (infra, not answer) never trips the canary: the stop-the-line gate ` +
        `exists to protect slots from a doomed PLAN". spawned: ${JSON.stringify(one.spawned)}`,
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
