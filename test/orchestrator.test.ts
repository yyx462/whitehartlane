import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import {
  cycle,
  runOrchestrator,
  type CycleDeps,
  type ShepPort,
} from "../src/orchestrator.ts"
import { hooksFromDir } from "../src/hooks.ts"
import { readRows, readState, settleUnit } from "../src/state.ts"
import { copyExample } from "./util.ts"

type Wake = { label: string; kind: string; detail: string }

function fakeShep(overrides: Partial<ShepPort> = {}) {
  const spawned: string[] = []
  const retired: string[] = []
  const wakes: Wake[] = []
  const calls: string[] = []
  const reprompts: string[] = []
  const port: ShepPort = {
    spawnWorker: (name) => {
      spawned.push(name)
      return true
    },
    paneAlive: () => true,
    reprompt: (name) => {
      reprompts.push(name)
      return true
    },
    retire: (name) => {
      retired.push(name)
    },
    retireAll: () => {
      calls.push("retireAll")
    },
    verify: () => "pane-reap: 0 remaining",
    wake: (label, kind, detail) => {
      wakes.push({ label, kind, detail })
    },
    tailPane: () => true,
    ...overrides,
  }
  return { port, spawned, retired, wakes, calls, reprompts }
}

function deps(
  dir: string,
  port: ShepPort,
  extra: Partial<CycleDeps> = {},
): CycleDeps {
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: port,
    inFlight: new Map(),
    attempts: new Map(),
    ...extra,
  }
}

test("cycle spawns one worker per unsettled unit, up to the slots", async () => {
  const dir = await copyExample("orch-spawn-")
  const { port, spawned } = fakeShep()

  const done = cycle(deps(dir, port))

  assert.equal(done, false)
  assert.deepEqual(spawned, ["w-france", "w-japan", "w-peru"])
  assert.deepEqual(readState(dir), { done: [], failed: [] })
})

test("a done sentinel grades the unit, settles it, and wakes nobody", async () => {
  const dir = await copyExample("orch-done-")
  const { port, spawned, retired, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "france"
  mkdirSync(join(dir, "logs"), { recursive: true })
  writeFileSync(join(dir, "results", `${id}.txt`), "Paris\n")
  appendFileSync(join(dir, "logs", `${id}.log`), `done ${id}\n`)

  const done = cycle(base)

  assert.equal(done, false)
  assert.deepEqual(readState(dir).done, [id])
  assert.deepEqual(readRows(dir), [{ unit: id, result: "found", pass: true }])
  assert.ok(retired.includes(`w-${id}`))
  assert.deepEqual(wakes, [])
  assert.equal(spawned.length, 3)
})

test("a failed grade settles the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-grade-")
  const { port, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "japan"
  mkdirSync(join(dir, "logs"), { recursive: true })
  appendFileSync(join(dir, "logs", `${id}.log`), `done ${id}\n`)

  cycle(base)

  assert.deepEqual(readState(dir).failed, [id])
  assert.deepEqual(readRows(dir), [{ unit: id, result: "missing", pass: false }])
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].kind, "blocked")
})

test("a blocked line settles the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-blocked-")
  const { port, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "peru"
  mkdirSync(join(dir, "logs"), { recursive: true })
  appendFileSync(join(dir, "logs", `${id}.log`), `blocked ${id}: stuck on dialog\n`)

  cycle(base)

  assert.deepEqual(readState(dir).failed, [id])
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].label, id)
})

test("a dead pane settles the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-dead-")
  const { port, wakes } = fakeShep({ paneAlive: () => false })
  const base = deps(dir, port)
  cycle(base)

  const done = cycle(base)

  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.equal(done, true)
  assert.equal(wakes.length, 3)
})

test("a worker whose log goes quiet past the stall window settles failed", async () => {
  const dir = await copyExample("orch-stall-")
  let clock = 0
  const { port, wakes } = fakeShep()
  const base = deps(dir, port, { stallMs: 1000, now: () => clock })
  cycle(base)

  clock = 2000
  const done = cycle(base)

  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.equal(done, true)
  assert.equal(wakes.length, 3)
})

test("a worker whose log never appears gets exactly one reprompt after the grace window", async () => {
  const dir = await copyExample("orch-reprompt-")
  let clock = 0
  const { port, reprompts, spawned } = fakeShep()
  const base = deps(dir, port, { briefGraceMs: 60_000, now: () => clock })

  cycle(base)
  assert.deepEqual(reprompts, [])

  clock = 30_000
  cycle(base)
  assert.deepEqual(reprompts, [])

  clock = 90_000
  cycle(base)
  assert.deepEqual(reprompts, ["w-france", "w-japan", "w-peru"])

  clock = 150_000
  cycle(base)
  assert.deepEqual(reprompts, ["w-france", "w-japan", "w-peru"])
  assert.equal(spawned.length, 3)
})

test("a reprompted worker that then writes its sentinel settles normally", async () => {
  const dir = await copyExample("orch-reprompt-ok-")
  let clock = 0
  const { port, reprompts, wakes } = fakeShep({
    reprompt: (name) => {
      reprompts.push(name)
      const id = name.slice(2)
      mkdirSync(join(dir, "logs"), { recursive: true })
      writeFileSync(join(dir, "results", `${id}.txt`), "capital\n")
      appendFileSync(join(dir, "logs", `${id}.log`), `done ${id}\n`)
      return true
    },
  })
  const base = deps(dir, port, { briefGraceMs: 60_000, now: () => clock })

  cycle(base)
  clock = 90_000
  const settled = cycle(base)   // reprompt fires here, sentinels land
  const done = cycle(base)      // next poll settles them

  assert.equal(settled, false)
  assert.equal(done, true)
  assert.deepEqual(readState(dir).done, ["france", "japan", "peru"])
  assert.deepEqual(wakes.filter((w) => w.kind === "blocked"), [])
})

test("cycle skips units already settled", async () => {
  const dir = await copyExample("orch-resume-")
  settleUnit(dir, "france", true, { unit: "france", result: "found", pass: true })
  const { port, spawned } = fakeShep()

  cycle(deps(dir, port))

  assert.deepEqual(spawned, ["w-japan", "w-peru"])
})

test("a unit whose spawn fails three times settles failed and wakes", async () => {
  const dir = await copyExample("orch-spawnfail-")
  const { port, wakes, spawned } = fakeShep({ spawnWorker: () => false })
  const base = deps(dir, port)

  const first = cycle(base)
  const second = cycle(base)
  const third = cycle(base)

  assert.equal(first, false)
  assert.equal(second, false)
  assert.equal(third, true)
  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.equal(wakes.length, 3)
  assert.equal(spawned.length, 0)
})

test("runOrchestrator settles everything, writes the report, and quotes the receipt", async () => {
  const dir = await copyExample("orch-full-")
  const { port, wakes, calls, retired } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      const id = name.slice(2)
      writeFileSync(join(cwd, "results", `${id}.txt`), "capital\n")
      appendFileSync(join(cwd, "logs", `${id}.log`), `done ${id}\n`)
      return true
    },
  })

  const report = await runOrchestrator({
    taskDir: dir,
    shep: port,
    sleep: () => Promise.resolve(),
    log: () => {},
  })

  assert.equal(report.status, "done")
  assert.deepEqual(report.counts, { lookups: 3, failed: 0 })
  assert.deepEqual(
    report.table.map((row) => row.result),
    ["found", "found", "found"],
  )
  assert.ok(calls.includes("retireAll"))
  assert.deepEqual(retired, ["w-france", "w-japan", "w-peru"])
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].kind, "done")
  assert.ok(wakes[0].detail.includes("pane-reap: 0 remaining"))
  const written = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))
  assert.equal(written.status, "done")
})

test("runOrchestrator stops at the deadline, settles the rest failed, and wakes", async () => {
  const dir = await copyExample("orch-deadline-")
  let clock = 0
  const { port, wakes } = fakeShep()

  const report = await runOrchestrator({
    taskDir: dir,
    shep: port,
    deadlineMs: 1000,
    pollMs: 500,
    now: () => clock,
    sleep: (ms) => {
      clock += ms
      return Promise.resolve()
    },
    log: () => {},
  })

  assert.equal(report.status, "failed")
  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.ok(wakes.length >= 1)
})
