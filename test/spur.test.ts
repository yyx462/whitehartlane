import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { order, parseDag, ready, tick, type Dag, type TickIn } from "../src/dag.ts"

const program = readFileSync(join(import.meta.dirname, "..", "examples", "lab-spurs", "lab-program", "dag.mjs"), "utf8")

function dag(): Dag {
  return parseDag(program)
}

function state(over: Partial<TickIn> = {}): TickIn {
  return {
    done: [],
    actorBorn: false,
    signal: "missing",
    waveKey: "",
    openedWave: "",
    ends: [],
    graded: [],
    prompted: false,
    gatesReady: [],
    ...over,
  }
}

test("a program is one small dag file and does not schedule", () => {
  assert.ok(program.split("\n").length < 20)
  assert.equal(program.includes("fan-out-orchestrator"), false)
  assert.equal(program.includes("while"), false)
  assert.deepEqual(order(dag()), ["professor", "students", "grade", "report"])
  const ran = spawnSync(process.execPath, [join(import.meta.dirname, "..", "examples", "lab-spurs", "lab-program", "dag.mjs")], {
    encoding: "utf8",
  })
  assert.equal(ran.status, 0)
  assert.equal(ran.stdout, "")
  assert.equal(ran.stderr, "")
})

test("the file is not a second scheduler", () => {
  assert.throws(() => parseDag(`${program}\nwhile (true) spawn("fan-out-orchestrator")\n`), /does not schedule/)
  assert.throws(() => parseDag('export const dag = { name: "x", steps: [{ id: "a", does: "actor", after: run() }] }\n'), /does not call/)
  assert.throws(() => parseDag('export const dag = { name: "x", steps: [{ id: "a", does: "actor" }, { id: "b", does: "wave", after: ["a"] }, { id: "a", does: "grade" }] }\n'), /duplicate/)
  assert.throws(() => parseDag('export const dag = { name: "x", steps: [{ id: "a", does: "wave", after: ["b"] }, { id: "b", does: "grade", after: ["a"] }] }\n'), /cyclic/)
})

test("a program names one step per singleton verb; gates may be many", () => {
  assert.throws(
    () =>
      parseDag(
        'export const dag = { name: "x", steps: [{ id: "a", does: "wave" }, { id: "b", does: "wave", after: ["a"] }] }\n',
      ),
    /one wave step/,
  )
  assert.throws(
    () =>
      parseDag(
        'export const dag = { name: "x", steps: [{ id: "a", does: "report" }, { id: "b", does: "report", after: ["a"] }] }\n',
      ),
    /one report step/,
  )
  const twoGates = parseDag(`export const dag = {
    name: "gates",
    steps: [
      { id: "a", does: "wave" },
      { id: "g1", does: "gate", after: ["a"] },
      { id: "g2", does: "gate", after: ["a"] },
      { id: "r", does: "report", after: ["g1", "g2"] },
    ],
  }\n`)
  assert.equal(twoGates.steps.filter((step) => step.does === "gate").length, 2)
})

test("ready steps wait for the names in the file", () => {
  const file = dag()
  assert.deepEqual(ready(file, new Set()).map((step) => step.id), ["professor"])
  assert.deepEqual(ready(file, new Set(["professor"])).map((step) => step.id), ["students"])
  const parallel = parseDag(`export const dag = {
    name: "two",
    steps: [
      { id: "professor", does: "actor" },
      { id: "left", does: "wave", after: ["professor"] },
      { id: "right", does: "grade", after: ["professor"] },
    ],
  }\n`)
  assert.deepEqual(ready(parallel, new Set(["professor"])).map((step) => step.id), ["left", "right"])
})

test("the os schedules the file: professor, then students, grade on end, report on stop", () => {
  const file = dag()
  assert.deepEqual(tick(file, state()), [{ do: "birth-actor" }])
  const open = tick(file, state({
    actorBorn: true,
    signal: "wave",
    waveKey: "s1",
    ends: [{ id: "s1", end: null }],
  }))
  assert.deepEqual(open.map((action) => action.do), ["finish", "birth-wave"])
  const ended = tick(file, state({
    done: ["professor"],
    actorBorn: true,
    signal: "wave",
    waveKey: "s1",
    openedWave: "s1",
    ends: [{ id: "s1", end: "done" }],
  }))
  assert.equal(ended.some((action) => action.do === "grade" && action.id === "s1"), true)
  assert.equal(ended.some((action) => action.do === "report"), false)
  assert.equal(ended.some((action) => action.do === "prompt-actor"), false)
  const graded = tick(file, state({
    done: ["professor"],
    actorBorn: true,
    signal: "wave",
    waveKey: "s1",
    openedWave: "s1",
    ends: [{ id: "s1", end: "done" }],
    graded: ["s1"],
  }))
  assert.equal(graded.some((action) => action.do === "prompt-actor"), true)
  assert.equal(graded.some((action) => action.do === "report"), false)
  const stopped = tick(file, state({ signal: "stop" }))
  assert.equal(stopped.some((action) => action.do === "report"), true)
  assert.equal(stopped.some((action) => action.do === "birth-actor"), false)
  assert.equal(stopped.some((action) => action.do === "prompt-actor"), false)
})

test("a new protocol reopens students; the file does not loop", () => {
  const file = dag()
  const actions = tick(file, state({
    done: ["professor", "students", "grade"],
    actorBorn: true,
    signal: "wave",
    waveKey: "s2",
    openedWave: "s1",
    ends: [{ id: "s1", end: "done" }],
    graded: ["s1"],
    prompted: true,
  }))
  assert.deepEqual(actions, [{ do: "reopen", ids: ["students", "grade"] }])
})

const gateProgram = `export const dag = {
  name: "gate-run",
  steps: [
    { id: "professor", does: "actor" },
    { id: "students", does: "wave", after: ["professor"] },
    { id: "grade", does: "grade", after: ["students"] },
    { id: "await-review", does: "gate", after: ["grade"] },
    { id: "report", does: "report", after: ["await-review"] },
  ],
}\n`

test("a gate holds the report until its detector says ready", () => {
  const file = parseDag(gateProgram)
  assert.deepEqual(order(file), ["professor", "students", "grade", "await-review", "report"])
  const held = tick(file, state({
    done: ["professor", "students", "grade"],
    actorBorn: true,
    signal: "stop",
    ends: [{ id: "s1", end: "done" }],
    graded: ["s1"],
    gatesReady: [],
  }))
  assert.equal(held.some((action) => action.do === "finish" && action.id === "await-review"), false)
  assert.equal(held.some((action) => action.do === "report"), false)
  const released = tick(file, state({
    done: ["professor", "students", "grade"],
    actorBorn: true,
    signal: "stop",
    ends: [{ id: "s1", end: "done" }],
    graded: ["s1"],
    gatesReady: ["await-review"],
  }))
  assert.equal(released.some((action) => action.do === "finish" && action.id === "await-review"), true)
  assert.equal(released.some((action) => action.do === "report"), true)
})

test("a gate with no after-edges waits only on its detector", () => {
  const file = parseDag(`export const dag = {
    name: "gate-only",
    steps: [
      { id: "await-review", does: "gate" },
      { id: "report", does: "report", after: ["await-review"] },
    ],
  }\n`)
  const waiting = tick(file, state({ signal: "stop", gatesReady: [] }))
  assert.deepEqual(waiting, [])
  const ready = tick(file, state({ signal: "stop", gatesReady: ["await-review"] }))
  assert.equal(ready.some((action) => action.do === "report"), true)
})

test("a reopen clears the gates downstream of the wave", () => {
  const file = parseDag(gateProgram)
  const actions = tick(file, state({
    done: ["professor", "students", "grade", "await-review"],
    actorBorn: true,
    signal: "wave",
    waveKey: "s2",
    openedWave: "s1",
    ends: [{ id: "s1", end: "done" }],
    graded: ["s1"],
    prompted: true,
    gatesReady: ["await-review"],
  }))
  assert.deepEqual(actions, [{ do: "reopen", ids: ["students", "grade", "await-review"] }])
})
