import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace (OPTIMUM §8) — settles and
// state reads resolve a session there, so the suite needs its own disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-cd-"))

import { cycle, probeDeliverable, type CycleDeps, type ShepPort } from "../src/engines/orchestrator.ts"
import { hooksFromDir } from "../src/doors/hooks.ts"
import { readCheckpoints, readState } from "../src/core/state.ts"
import { readWakeBooking, waitEdges, waitingOnLiveChild, writeWakeBooking } from "../src/adapters/levy.ts"

import { copyExample } from "./util.ts"

type Ev = { kind: string; payload: Record<string, unknown> }

// A scripted shep: panes always spawn and stay alive; workerStatus is
// the test's state machine (the pane's own verdict, once per beat).
function fakeShep(status: () => "working" | "idle" | "blocked" | "unknown") {
  const reprompts: { name: string; briefPath: string }[] = []
  const retired: string[] = []
  const wakes: { label: string; kind: string; detail: string }[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    workerStatus: status,
    reprompt: (name, briefPath) => {
      reprompts.push({ name, briefPath })
      return true
    },
    retire: (name) => retired.push(name),
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: (label, kind, detail) => wakes.push({ label, kind, detail }),
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, reprompts, retired, wakes }
}

async function taskDirWith(unitId: string): Promise<string> {
  const dir = await copyExample("whl-cd-task-")
  writeFileSync(
    join(dir, "units.jsonl"),
    `${JSON.stringify({ id: unitId, brief: "Produce the deliverable named in the closing contract." })}\n`,
  )
  return dir
}

function deps(
  dir: string,
  port: ShepPort,
  extra: Partial<CycleDeps> = {},
): CycleDeps & { events: Ev[] } {
  const events: Ev[] = []
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: port,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    emit: (kind, payload) => events.push({ kind, payload }),
    events,
    ...extra,
  }
}

function cardsFor(dir: string, unitId: string) {
  return readCheckpoints(dir).filter((c) => c.unit === unitId)
}

// -- the platform pen: idle + deliverable settles with NO marker ------

test("status-first: idle agent with a present deliverable settles by platform pen — no marker, no stalled", async (t) => {
  const dir = await taskDirWith("demo")
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port, { settleMode: "status-first", fallbackLadder: false })

  cycle(d) // spawn beat (pane working)
  assert.ok(d.inFlight.has("demo"), "unit in flight after spawn")
  phase = "idle"
  writeFileSync(join(dir, "units", "demo", "result.md"), "Paris\n") // finished, marker forgotten
  cycle(d) // idle beat — the settle moment

  const cards = cardsFor(dir, "demo")
  const settleCard = cards.find((c) => c.stage === "settle:demo")
  assert.ok(settleCard, "a settle card landed")
  assert.equal(settleCard!.status, "ok")
  assert.equal(settleCard!.trigger, "idle+grade")
  assert.match(settleCard!.detail ?? "", /platform pen/)
  assert.ok(readState(dir).done.includes("demo"), "fold says done")
  assert.ok(!d.inFlight.has("demo"), "unit left the flight map")
  assert.ok(shep.retired.includes("w-demo"), "pane retired")
  // the negatives: no marker was ever written, no stalled verdict exists
  assert.ok(!existsSync(join(dir, "units", "demo", "log.txt")), "no marker file ever")
  assert.ok(!cards.some((c) => /stalled/.test(c.detail ?? "")), "no stalled card")
  assert.ok(!d.events.some((e) => e.kind === "unit.finished" && e.payload.pass === false), "no failed finish")
  const grade = d.events.find((e) => e.kind === "unit.grade")
  assert.ok(grade, "the grade evidence event fired")
  assert.equal(grade!.payload.status, "ok")
  assert.equal(grade!.payload.trigger, "idle")
})

// -- teach by evidence: one fail grade, one quoting reprompt, then ok --

test("status-first: idle agent with NO deliverable gets ONE evidence reprompt, then settles when it complies", async (t) => {
  const dir = await taskDirWith("demo2")
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port, { settleMode: "status-first", fallbackLadder: false })

  cycle(d) // spawn (working)
  phase = "idle"
  cycle(d) // idle, deliverable absent → attempt 1, evidence reprompt
  assert.equal(shep.reprompts.length, 1, "exactly one reprompt")
  const note = readFileSync(shep.reprompts[0]!.briefPath, "utf8")
  assert.match(note, /deliverable missing/, "the reprompt QUOTES the failing check")
  assert.match(note, /result\.md/, "and names the required artifact")
  assert.ok(d.inFlight.has("demo2"), "unit still open after the reprompt")
  const failGrade = d.events.find((e) => e.kind === "unit.grade")
  assert.equal(failGrade!.payload.status, "fail", "the fail grade is on the record first")

  phase = "working"
  cycle(d) // the agent takes the note and works
  writeFileSync(join(dir, "units", "demo2", "result.md"), "complied\n")
  phase = "idle"
  cycle(d) // idle again — settle

  const grades = d.events.filter((e) => e.kind === "unit.grade")
  assert.deepEqual(grades.map((g) => g.payload.status), ["fail", "ok"], "exactly one fail→ok cycle")
  assert.ok(readState(dir).done.includes("demo2"), "settled done after complying")
})

// -- the cap: a wrong-or-ignored check ends in a human verdict, never a loop

test("status-first: 8 evidence reprompts cap out into stalled-with-evidence quoting the probe", async (t) => {
  const dir = await taskDirWith("demo3")
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port, { settleMode: "status-first", fallbackLadder: false })

  cycle(d) // spawn
  // the agent keeps responding and never satisfies the probe: 8 full
  // work→idle cycles burn the cap, the 9th idle is the verdict
  for (let i = 0; i < 9; i++) {
    phase = "working"
    cycle(d)
    phase = "idle"
    cycle(d)
  }
  assert.equal(shep.reprompts.length, 8, "exactly 8 evidence reprompts")
  const stalled = cardsFor(dir, "demo3").find((c) => c.stage === "settle:demo3" && c.status === "FAILED")
  assert.ok(stalled, "the cap verdict landed")
  assert.match(stalled!.detail ?? "", /deliverable missing after 8 evidence reprompts/, "the verdict quotes the check")
  assert.ok(!d.inFlight.has("demo3"), "the loop ENDED")
  assert.ok(shep.wakes.some((w) => /deliverable missing after 8/.test(w.detail)), "the wake carries the story")
})

// -- the DAG: a live child owns the parent's silence -------------------

test("status-first: an idle parent with a live booked child waits — and settles once the child wakes", async (t) => {
  const dir = await taskDirWith("demo4")
  const childDir = mkdtempSync(join(tmpdir(), "whl-cd-child-"))
  writeWakeBooking(dir, "demo4", {
    jid: "j-child1",
    jobDir: childDir,
    folder: ".",
    leviedAt: new Date().toISOString(),
    parentUnit: "demo4",
    spawnerSession: "s-parent",
  })
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port, { settleMode: "status-first", fallbackLadder: false })

  cycle(d) // spawn
  phase = "idle"
  writeFileSync(join(dir, "units", "demo4", "result.md"), "done while waiting\n")
  cycle(d) // idle + deliverable, but a live child owns the silence
  assert.ok(d.inFlight.has("demo4"), "still waiting — no settle while the child is live")
  assert.equal(shep.reprompts.length, 0, "and no evidence reprompt either")

  writeFileSync(join(childDir, "wake.json"), JSON.stringify({ outcome: "done" }))
  cycle(d) // child woke — the parent may now settle
  assert.ok(readState(dir).done.includes("demo4"), "settled after the child woke")
})

// -- byte-identical default: no settleMode, no platform pen -----------

test("marker mode (default): idle + deliverable settles NOTHING — the worker pen is still the only path", async (t) => {
  const dir = await taskDirWith("demo5")
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port) // no settleMode

  cycle(d) // spawn
  phase = "idle"
  writeFileSync(join(dir, "units", "demo5", "result.md"), "Paris\n")
  cycle(d) // idle — old rail: nothing happens
  assert.ok(d.inFlight.has("demo5"), "still in flight — the marker is still the contract")
  assert.equal(cardsFor(dir, "demo5").length, 0, "no cards at all")
})

test("marker mode compat: the done marker still settles through the grade path", async (t) => {
  const dir = await taskDirWith("demo6")
  const shep = fakeShep(() => "working")
  const d = deps(dir, shep.port, { settleMode: "status-first" })

  cycle(d) // spawn
  writeFileSync(join(dir, "units", "demo6", "result.md"), "Paris\n")
  writeFileSync(join(dir, "units", "demo6", "log.txt"), `done demo6\n`)
  cycle(d) // marker path — hooks.grade (fixture: result.md non-empty → found)
  assert.ok(readState(dir).done.includes("demo6"), "marker settles through the grade path")
  const card = cardsFor(dir, "demo6").find((c) => c.stage === "grade:demo6")
  assert.ok(card, "the marker path's grade card is intact")
})

// -- unknown panes: the fallback ladder is the lane, and the switch kills it --

test("unknown pane past the stall window: the ladder still rules (fallback on), and stays its hand when switched off", async (t) => {
  const dir = await taskDirWith("demo7")
  let clock = 1_000_000
  const shep = fakeShep(() => "unknown")
  const d = deps(dir, shep.port, {
    settleMode: "status-first",
    stallMs: 100,
    now: () => clock,
  })

  cycle(d) // spawn
  clock += 10_000 // deep silence
  cycle(d) // unknown + fallback ON → the old honest verdict
  assert.ok(!d.inFlight.has("demo7"), "the ladder ruled")
  const stalled = cardsFor(dir, "demo7").find((c) => c.status === "FAILED")
  assert.ok(stalled, "stalled card for a status-blind pane")
  assert.match(stalled!.detail ?? "", /no log output/)

  const dir2 = await taskDirWith("demo8")
  clock = 1_000_000
  const shep2 = fakeShep(() => "unknown")
  const d2 = deps(dir2, shep2.port, {
    settleMode: "status-first",
    fallbackLadder: false,
    stallMs: 100,
    now: () => clock,
  })
  cycle(d2) // spawn
  clock += 10_000
  cycle(d2) // suppressed — no kill during the trial window
  assert.ok(d2.inFlight.has("demo8"), "the switch held the ladder's hand")
  assert.equal(cardsFor(dir2, "demo8").length, 0, "no verdict at all")
})

// -- the DAG round-trip: writer shape ≡ reader shape -------------------

test("WakeBooking round-trip: parentUnit and spawnerSession survive the write and feed the edge builder", async (t) => {
  const dir = await taskDirWith("demo9")
  const childDir = mkdtempSync(join(tmpdir(), "whl-cd-child2-"))
  writeWakeBooking(dir, "demo9", {
    jid: "j-c1",
    jobDir: childDir,
    folder: ".",
    leviedAt: "2026-10-20T00:00:00.000Z",
    parentUnit: "demo9",
    spawnerSession: "s-par",
  })
  const back = readWakeBooking(dir, "demo9")!
  assert.equal(back.parentUnit, "demo9")
  assert.equal(back.spawnerSession, "s-par")
  assert.equal(back.jid, "j-c1")

  const edges = waitEdges(dir)
  assert.deepEqual(edges.map((e) => [e.parentUnit, e.jid]), [["demo9", "j-c1"]], "the parser eats exactly what the writer laid down")

  assert.ok(waitingOnLiveChild(dir, "demo9"), "live child: no wake.json yet")
  writeFileSync(join(childDir, "wake.json"), "{}")
  assert.ok(!waitingOnLiveChild(dir, "demo9"), "child woke — not a wait")

  // dangling: a booking whose child dir vanished folds to not-waiting
  const dir2 = await taskDirWith("demo10")
  writeWakeBooking(dir2, "demo10", {
    jid: "j-gone",
    jobDir: join(tmpdir(), "whl-cd-no-such-child-"),
    folder: ".",
    leviedAt: "2026-10-20T00:00:00.000Z",
    parentUnit: "demo10",
  })
  assert.ok(!waitingOnLiveChild(dir2, "demo10"), "a dangling edge is not a wait")
})

// -- the probe itself: shape only --------------------------------------

test("probeDeliverable judges shape only — absent, empty, present", async (t) => {
  const dir = await taskDirWith("demo11")
  assert.equal(probeDeliverable(dir, "demo11").ok, false)
  mkdirSync(join(dir, "units", "demo11"), { recursive: true })
  writeFileSync(join(dir, "units", "demo11", "result.md"), "")
  assert.equal(probeDeliverable(dir, "demo11").ok, false, "an empty deliverable is not a deliverable")
  writeFileSync(join(dir, "units", "demo11", "result.md"), "x")
  assert.equal(probeDeliverable(dir, "demo11").ok, true)
})
