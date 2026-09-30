import assert from "node:assert/strict"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import {
  cycle,
  paneLabeler,
  runOrchestrator,
  type CycleDeps,
  type ShepPort,
} from "../src/orchestrator.ts"
import { hooksFromDir } from "../src/hooks.ts"
import { readState, settleUnit } from "../src/state.ts"
import { copyExample } from "./util.ts"

type Wake = { label: string; kind: string; detail: string }

function fakeShep(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const spawned: string[] = []
  const retired: string[] = []
  const wakes: Wake[] = []
  const calls: string[] = []
  const reprompts: string[] = []
  const seq: string[] = []
  const port: ShepPort = {
    setLayout: (overrides.setLayout as ShepPort["setLayout"]) ?? (() => {}),
    spawnWorker: (name, kind, briefPath, cwd) => {
      spawned.push(name)
      seq.push(`spawn:${name}`)
      const fn = overrides.spawnWorker as ShepPort["spawnWorker"] | undefined
      return fn ? fn(name, kind, briefPath, cwd) : true
    },
    paneAlive: (overrides.paneAlive as ShepPort["paneAlive"]) ?? (() => true),
    reprompt: (name, briefPath) => {
      reprompts.push(name)
      const fn = overrides.reprompt as ShepPort["reprompt"] | undefined
      return fn ? fn(name, briefPath) : true
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
    tailPane: (logPath) => {
      seq.push("tail")
      const fn = overrides.tailPane as ShepPort["tailPane"] | undefined
      return fn ? fn(logPath) : true
    },
  }
  return { port, spawned, retired, wakes, calls, reprompts, seq }
}

function deps(
  dir: string,
  port: ShepPort,
  extra: Partial<CycleDeps> = {},
): CycleDeps & { events: { kind: string; payload: Record<string, unknown> }[] } {
  const events: { kind: string; payload: Record<string, unknown> }[] = []
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: port,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    emit: (kind, payload) => events.push({ kind, payload }),
    ...extra,
    events,
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

test("the default slot cap is 2 — the third unit waits for a settle", async () => {
  const dir = await copyExample("orch-slots-")
  const { port, spawned } = fakeShep()
  const base = deps(dir, port)
  base.slots = undefined

  cycle(base)
  assert.deepEqual(spawned, ["w-france", "w-japan"])

    appendFileSync(join(dir, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(dir, "units", "france", "result.md"), "Paris\n")
  cycle(base)
  assert.deepEqual(spawned, ["w-france", "w-japan", "w-peru"])
})

test("a done sentinel grades the unit, settles it, and wakes nobody", async () => {
  const dir = await copyExample("orch-done-")
  const { port, spawned, retired, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "france"
    writeFileSync(join(dir, "units", id, "result.md"), "Paris\n")
  appendFileSync(join(dir, "units", id, "log.txt"), `done ${id}\n`)

  const done = cycle(base)

  assert.equal(done, false)
  assert.deepEqual(readState(dir).done, [id])
  assert.deepEqual(base.events.find((e) => e.kind === "unit.settled")?.payload.result, "found")
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
    appendFileSync(join(dir, "units", id, "log.txt"), `done ${id}\n`)

  cycle(base)

  assert.deepEqual(readState(dir).failed, [id])
  assert.deepEqual(base.events.find((e) => e.kind === "unit.settled")?.payload.result, "missing")
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].kind, "blocked")
})

test("a blocked line settles the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-blocked-")
  const { port, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "peru"
    appendFileSync(join(dir, "units", id, "log.txt"), `blocked ${id}: stuck on dialog\n`)

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
            writeFileSync(join(dir, "units", id, "result.md"), "capital\n")
      appendFileSync(join(dir, "units", id, "log.txt"), `done ${id}\n`)
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

test("pane labels are run-scoped, idempotent, and shep-safe", () => {
  const label = paneLabeler("k2x9f7ab")
  const a = label("w-europe-capitals")
  assert.equal(label("w-europe-capitals"), a) // idempotent per name
  assert.match(a, /^w-europe-capitals-k2x9f7ab$/)
  assert.ok(a.length <= 32, `label too long: ${a}`)

  const other = label("w-asia-capitals")
  assert.notEqual(other, a)

  // long names are trimmed to fit the 32-char shep limit
  const long = label("w-a-very-long-unit-name-exceeding-budget")
  assert.ok(long.length <= 32, `long label: ${long}`)
  assert.match(long, /-k2x9f7ab$/)

  // two names that trim to the same stem get distinct labels within the run
  const first = label("w-duplicate-stem-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  const second = label("w-duplicate-stem-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
  assert.notEqual(first, second)

  // a different run id yields different labels for the same name
  const otherRun = paneLabeler("zz99zz99")
  assert.notEqual(otherRun("w-europe-capitals"), a)
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
  assert.equal(spawned.length, 9)
})

test("runOrchestrator settles everything, writes the report, and quotes the receipt", async () => {
  const dir = await copyExample("orch-full-")
  const { port, wakes, calls, retired, seq } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "capital\n")
      appendFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
  })

  const report = await runOrchestrator({
    taskDir: dir,
    shep: port,
    checkMs: 10,
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
  // default layout is new-tab with the orchestrator lane on the left:
  // the lane opens before any worker spawns
  assert.equal(seq.indexOf("tail") < seq.indexOf("spawn:w-france"), true)
})

test("runOrchestrator stops at the deadline, settles the rest failed, and wakes", async () => {
  const dir = await copyExample("orch-deadline-")
  const { port, wakes } = fakeShep()

  const report = await runOrchestrator({
    taskDir: dir,
    shep: port,
    deadlineMs: 50,
    checkMs: 10,
    log: () => {},
  })

  assert.equal(report.status, "failed")
  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.ok(wakes.length >= 1)
})

test("an orchestrator-side layout of right opens the lane after the first cycle", async () => {
  const pi = await copyExample("orch-side-right-")
  const { port, seq } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "capital\n")
      appendFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
  })

  await runOrchestrator({
    taskDir: pi,
    shep: port,
    layout: { tab: "same", orchestrator: "right" },
    checkMs: 10,
    log: () => {},
  })

  assert.equal(seq.indexOf("spawn:w-france") < seq.indexOf("tail"), true)
})

test("the manifest layout section resolves with defaults and rejects bad values", async () => {
  const dir = await copyExample("orch-layout-")
  const { loadManifest, resolvedLayout } = await import("../src/hooks.ts")
  const original = readFileSync(join(dir, "workflow.toml"), "utf8")

  const flipped = original
    .replace('tab = "new"', 'tab = "same"')
    .replace('orchestrator = "left"', 'orchestrator = "right"')
  writeFileSync(join(dir, "workflow.toml"), flipped)
  assert.deepEqual(resolvedLayout(loadManifest(dir)), { tab: "same", orchestrator: "right" })

  writeFileSync(join(dir, "workflow.toml"), original.replace('tab = "new"', 'tab = "middle"'))
  assert.throws(() => resolvedLayout(loadManifest(dir)), /layout\.tab/)

  writeFileSync(
    join(dir, "workflow.toml"),
    original.replace(/\[layout\][\s\S]*$/, "").trim() + "\n",
  )
  assert.deepEqual(resolvedLayout(loadManifest(dir)), { tab: "new", orchestrator: "left" })
  assert.equal(loadManifest(dir).workflow.slots, 2)

  writeFileSync(join(dir, "workflow.toml"), original.replace("slots = 2", "slots = 0"))
  assert.throws(() => loadManifest(dir), /slots must be an integer 1-9/)
})
