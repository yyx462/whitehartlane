import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace (OPTIMUM §8) — settles and
// state reads resolve a session there, so the suite needs its own disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-bench-"))

import { benchOrder, cycle, type CycleDeps, type ShepPort } from "../src/engines/orchestrator.ts"
import { hooksFromDir } from "../src/doors/hooks.ts"
import { readCheckpoints, readState } from "../src/core/state.ts"

import { copyExample } from "./util.ts"

// ── the seating is the design: mode flags compose the bench ─────────

test("benchOrder: the marker court — no pen, the stall ladder seated (the byte-identical default)", () => {
  assert.deepEqual(benchOrder({}), ["marker", "liveness", "privilege", "grace", "stall"])
  assert.deepEqual(benchOrder({ settleMode: "marker", fallbackLadder: true }), [
    "marker",
    "liveness",
    "privilege",
    "grace",
    "stall",
  ], "an explicit marker mode seats the same court as the default")
})

test("benchOrder: the status-first trial court — pen seated, the old killer unseated (ADR 0015)", () => {
  assert.deepEqual(benchOrder({ settleMode: "status-first", fallbackLadder: false }), [
    "marker",
    "liveness",
    "privilege",
    "grace",
    "pen",
  ])
})

test("benchOrder: the pen outranks the stall ladder when both are seated — idle panes reach the platform pen first", () => {
  const seats = benchOrder({ settleMode: "status-first" })
  assert.ok(seats.indexOf("pen") < seats.indexOf("stall"), "pen before stall, always")
  assert.deepEqual(seats, ["marker", "liveness", "privilege", "grace", "pen", "stall"])
})

test("benchOrder: a drain unseats the stall judge — no verdict may fire while parking", () => {
  assert.ok(!benchOrder({ draining: true }).includes("stall"))
  assert.ok(!benchOrder({ settleMode: "status-first", draining: true }).includes("stall"))
  // the pen KEEPS its seat under a drain: an idle+deliverable pane
  // settling is exactly what a drain wants
  assert.ok(benchOrder({ settleMode: "status-first", draining: true }).includes("pen"))
})

// ── the bench in session: precedence and the one close ceremony ─────

function fakeShep(over: Partial<ShepPort> = {}) {
  const retired: string[] = []
  const wakes: { label: string; kind: string; detail: string }[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    reprompt: () => true,
    retire: (name) => retired.push(name),
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: (label, kind, detail) => wakes.push({ label, kind, detail }),
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    ...over,
  }
  return { port, retired, wakes }
}

async function taskDirWith(unitId: string): Promise<string> {
  const dir = await copyExample("whl-bench-task-")
  writeFileSync(
    join(dir, "units.jsonl"),
    `${JSON.stringify({ id: unitId, brief: "Produce the deliverable named in the closing contract." })}\n`,
  )
  return dir
}

function deps(dir: string, port: ShepPort, extra: Partial<CycleDeps> = {}): CycleDeps {
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: port,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    ...extra,
  }
}

test("the marker judge outranks liveness: a done log settles by grade even when the pane is already gone", async () => {
  const dir = await taskDirWith("ghost")
  const shep = fakeShep({ paneAlive: () => false }) // dead by liveness — done by marker
  const d = deps(dir, shep.port)

  cycle(d) // spawn
  writeFileSync(join(dir, "units", "ghost", "result.md"), "Paris\n")
  writeFileSync(join(dir, "units", "ghost", "log.txt"), "done ghost\n")
  cycle(d) // the bench: marker rules before liveness can

  assert.ok(readState(dir).done.includes("ghost"), "the marker's grade path settled it, not a pane-dead verdict")
  const cards = readCheckpoints(dir).filter((c) => c.unit === "ghost")
  assert.ok(cards.some((c) => c.stage === "grade:ghost"), "the grade ceremony's card landed")
  assert.ok(!cards.some((c) => /dead/.test(c.detail ?? "")), "liveness never ruled — the bench stopped at the marker")
})

test("the bailiff writes every close through one ceremony — the capped card carries the honest unit stage", async () => {
  const dir = await taskDirWith("capped")
  const shep = fakeShep({
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set(["w-capped"]) }),
  })
  const d = deps(dir, shep.port, { slots: 1 })

  cycle(d) // spawn
  cycle(d) // capped — the privilege judge closes it

  assert.deepEqual(readState(dir).failed, ["capped"])
  assert.deepEqual(shep.retired, ["w-capped"]) // the ceremony retired the pane
  assert.ok(shep.wakes.some((w) => /permission deny cap/.test(w.detail)))
  // the fixed wart: the close ceremony makes the stage label mandatory —
  // the old hand-rolled close missed it and cards read "undefined:capped"
  const card = readCheckpoints(dir).find((c) => c.unit === "capped")
  assert.equal(card!.stage, "unit:capped", "the card stage is the honest unit label")
})

test("a defer is explained silence, not a verdict: an answered dialog resets the clock and closes nothing", async () => {
  const dir = await taskDirWith("dialog")
  let answered = false
  const shep = fakeShep({
    tickPrivilege: () => ({
      answered: answered ? new Set(["w-dialog"]) : new Set<string>(),
      capped: new Set<string>(),
    }),
  })
  const d = deps(dir, shep.port, { stallMs: 10, now: () => 1_000_000 })

  cycle(d) // spawn
  answered = true
  cycle(d) // privilege judge defers — no card, no retire, flight stays

  assert.ok(d.inFlight.has("dialog"), "still in flight")
  assert.deepEqual(shep.retired, [])
  assert.equal(readCheckpoints(dir).filter((c) => c.unit === "dialog").length, 0, "a defer writes no card")
})
