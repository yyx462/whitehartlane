import assert from "node:assert/strict"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace (OPTIMUM §8) — settles and
// state reads resolve a session there, so the suite needs its own disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-orch-"))

import {
  acquireUnits,
  cycle,
  paneLabeler,
  runOrchestrator,
  worktreeChurnedSince,
  type CycleDeps,
  type ShepPort,
} from "../src/orchestrator.ts"
import { RefusedError } from "../src/backpressure.ts"
import { HookError } from "../src/hooks.ts"
import { hooksFromDir } from "../src/hooks.ts"
import { readCheckpoints, readState, settle } from "../src/state.ts"

import { copyExample } from "./util.ts"

type Wake = { label: string; kind: string; detail: string }

function fakeShep(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const spawned: string[] = []
  const retired: string[] = []
  const wakes: Wake[] = []
  const calls: string[] = []
  const reprompts: string[] = []
  const port: ShepPort = {
    setLayout: (overrides.setLayout as ShepPort["setLayout"]) ?? (() => {}),
    spawnWorker: (name, kind, briefPath, cwd) => {
      spawned.push(name)
      const fn = overrides.spawnWorker as ShepPort["spawnWorker"] | undefined
      return fn ? fn(name, kind, briefPath, cwd) : true
    },
    paneAlive: (overrides.paneAlive as ShepPort["paneAlive"]) ?? (() => true),
    workerStatus:
      (overrides.workerStatus as ShepPort["workerStatus"] | undefined) ??
      (() => "unknown" as const),
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
    tickPrivilege:
      (overrides.tickPrivilege as ShepPort["tickPrivilege"] | undefined) ??
      (() => ({ answered: new Set<string>(), capped: new Set<string>() })),
  }
  return { port, spawned, retired, wakes, calls, reprompts }
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

test("canary runs one unit, stops the job on a fail, and scales on a pass", async () => {
  const stopped = await copyExample("orch-canary-stop-")
  const stopShep = fakeShep()
  const failed = { enabled: true, released: false, failed: false }
  const stopDeps = deps(stopped, stopShep.port, { canary: failed, slots: 3 })
  cycle(stopDeps)
  assert.deepEqual(stopShep.spawned, ["w-france"])
  appendFileSync(join(stopped, "units", "france", "log.txt"), "done france\n")
  cycle(stopDeps)
  assert.equal(failed.failed, true)
  assert.equal(existsSync(join(stopped, "units", "france", ".grade-jev")), true)
  cycle(stopDeps)
  assert.deepEqual(stopShep.spawned, ["w-france"])

  const passed = await copyExample("orch-canary-go-")
  const goShep = fakeShep()
  const released = { enabled: true, released: false, failed: false }
  const goDeps = deps(passed, goShep.port, { canary: released, slots: 3 })
  cycle(goDeps)
  appendFileSync(join(passed, "units", "france", "log.txt"), "done france\n")
  writeFileSync(join(passed, "units", "france", "result.md"), "Paris\n")
  cycle(goDeps)
  assert.equal(released.released, true)
  assert.deepEqual(goShep.spawned, ["w-france", "w-japan", "w-peru"])
})

test("a grade that throws fails its unit, not the run (j-5701b2)", async () => {
  const dir = await copyExample("orch-grade-throw-")
  const { port, wakes } = fakeShep()
  const base = deps(dir, port, { slots: 3 })
  const realGrade = base.hooks.grade
  base.hooks = {
    ...base.hooks,
    grade: (unit) => {
      if (unit.id === "france") throw new HookError("hook timed out after 300000ms: bash hooks/grade.sh france")
      return realGrade(unit)
    },
  }
  cycle(base) // spawn all three
  for (const id of ["france", "japan", "peru"]) {
    mkdirSync(join(dir, "units", id), { recursive: true })
    writeFileSync(join(dir, "units", id, "result.md"), "capital\n")
    appendFileSync(join(dir, "units", id, "log.txt"), `done ${id}\n`)
  }
  const complete = cycle(base)
  assert.equal(complete, true, "the run finishes despite one grade exploding")
  const state = readState(dir)
  assert.deepEqual(state.done, ["japan", "peru"])
  assert.deepEqual(state.failed, ["france"])
  assert.ok(wakes.some((w) => w.label === "france" && w.detail.startsWith("grade error:")), "the wake carries the story")
})

test("cycle spawns one worker per unfinished unit, up to the slots", async () => {
  const dir = await copyExample("orch-spawn-")
  const { port, spawned } = fakeShep()

  const done = cycle(deps(dir, port))

  assert.equal(done, false)
  assert.deepEqual(spawned, ["w-france", "w-japan", "w-peru"])
  assert.deepEqual(readState(dir), { done: [], failed: [] })
})

test("the default slot cap is 2 — the third unit waits for a finish", async () => {
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

test("a done sentinel grades the unit, finished_by it, and wakes nobody", async () => {
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
  assert.deepEqual(base.events.find((e) => e.kind === "unit.finished")?.payload.result, "found")
  assert.ok(retired.includes(`w-${id}`))
  assert.deepEqual(wakes, [])
  assert.equal(spawned.length, 3)
})

test("a failed grade finished_by the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-grade-")
  const { port, wakes } = fakeShep()
  const base = deps(dir, port)
  cycle(base)

  const id = "japan"
    appendFileSync(join(dir, "units", id, "log.txt"), `done ${id}\n`)

  cycle(base)

  assert.deepEqual(readState(dir).failed, [id])
  assert.deepEqual(base.events.find((e) => e.kind === "unit.finished")?.payload.result, "missing")
  assert.equal(wakes.length, 1)
  assert.equal(wakes[0].kind, "blocked")
})

test("a blocked line finished_by the unit failed and wakes the shepherd", async () => {
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

test("a dead pane finished_by the unit failed and wakes the shepherd", async () => {
  const dir = await copyExample("orch-dead-")
  const { port, wakes } = fakeShep({ paneAlive: () => false })
  const base = deps(dir, port)
  cycle(base)

  const done = cycle(base)

  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.equal(done, true)
  assert.equal(wakes.length, 3)
})

test("a worker whose log goes quiet past the stall window finished_by failed", async () => {
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

test("worktree churn defers the stall; the kill returns when the tree goes quiet", async () => {
  const dir = await copyExample("orch-churn-")
  let clock = 0
  let churning = true
  const { port, wakes } = fakeShep()
  const base = deps(dir, port, {
    stallMs: 1000,
    now: () => clock,
    churnSince: (_wt, _since) => churning,
  })
  cycle(base)

  // past the stall window with the log quiet: the tree is moving, so
  // the workers live on (j-3520f7 — killed at 80% for silent logging)
  clock = 2000
  let done = cycle(base)
  assert.equal(done, false)
  assert.equal(readState(dir).failed.length, 0)
  assert.equal(wakes.length, 0)
  assert.equal(base.events.filter((e) => e.kind === "stall-deferred").length, 3)

  // the tree goes quiet: the next silent window kills
  churning = false
  clock = 5000
  done = cycle(base)
  assert.equal(done, true)
  assert.deepEqual(readState(dir).failed, ["france", "japan", "peru"])
  assert.equal(wakes.length, 3)
})

test("a working agent outlives a quiet log and a quiet tree (j-964391)", async () => {
  const dir = await copyExample("orch-agent-working-")
  let clock = 0
  let working = true
  const { port, wakes } = fakeShep({ workerStatus: (name) => (working && name === "w-france" ? "working" : "unknown") })
  const base = deps(dir, port, { stallMs: 1000, now: () => clock })
  cycle(base)

  // log quiet, tree quiet, agent mid-generation: france lives on
  clock = 2500
  let done = cycle(base)
  assert.equal(done, false)
  assert.ok(base.inFlight.has("france"))
  assert.deepEqual(readState(dir).failed, ["japan", "peru"])
  assert.equal(wakes.length, 2)

  // the generation ends and the silence persists: the next window kills
  working = false
  clock = 6000
  done = cycle(base)
  assert.equal(done, true)
  assert.deepEqual(readState(dir).failed, ["japan", "peru", "france"])
  assert.equal(wakes.length, 3)
})

test("worktreeChurnedSince reads real mtimes and stays false on a dead probe", async () => {
  const wt = mkdtempSync(join(tmpdir(), "churn-real-"))
  const file = join(wt, "edit.txt")
  writeFileSync(file, "work")
  const t0 = Date.now() - 60_000
  utimesSync(file, new Date(t0), new Date(t0))
  utimesSync(wt, new Date(t0), new Date(t0))

  assert.equal(worktreeChurnedSince(wt, t0 - 1000), true, "a file newer than since is churn")
  assert.equal(worktreeChurnedSince(wt, t0 + 1000), false, "nothing newer than since")
  assert.equal(worktreeChurnedSince(join(wt, "gone"), t0), false, "missing worktree is not churn")
})

test("a booked wait stands the stall clock down; the stall returns when the child is gone", async () => {
  const dir = await copyExample("orch-booked-")
  let clock = 0
  let booked = true
  const { port, wakes } = fakeShep()
  const base = deps(dir, port, {
    stallMs: 1000,
    now: () => clock,
    bookedWait: (id) => booked && id === "france",
  })
  cycle(base)

  // past the stall window: france is in a booked wait (a live child
  // spur holds its session), japan and peru are not
  clock = 5000
  cycle(base)
  assert.deepEqual(readState(dir).failed, ["japan", "peru"])
  assert.ok(base.inFlight.has("france"), "the booked-wait pane stays in flight")
  assert.equal(wakes.length, 2)

  // the wait holds across many stall windows — the clock restarts
  // each time the wait is seen
  clock = 9000
  cycle(base)
  assert.ok(base.inFlight.has("france"))

  // the child retires: the stall applies again, from a fresh window
  booked = false
  clock = 12000
  const done = cycle(base)
  assert.deepEqual(readState(dir).failed, ["japan", "peru", "france"])
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

test("a working worker is not grace-reprompted — the heartbeat defers until idle (j-78ca43)", async () => {
  const dir = await copyExample("orch-grace-working-")
  let clock = 0
  let working = true
  const { port, reprompts } = fakeShep({ workerStatus: () => (working ? "working" : "unknown") })
  const base = deps(dir, port, { briefGraceMs: 60_000, now: () => clock })

  cycle(base)
  clock = 90_000
  cycle(base) // past grace, but every pane reports working → no re-brief
  assert.deepEqual(reprompts, [])

  working = false
  clock = 150_000
  cycle(base) // idle now — the missing log means something again
  assert.deepEqual(reprompts, ["w-france", "w-japan", "w-peru"])

  clock = 210_000
  cycle(base) // exactly one, ever
  assert.deepEqual(reprompts, ["w-france", "w-japan", "w-peru"])
})

test("acquireUnits retries a provider refusal with backpressure events, then succeeds", async () => {
  const dir = await copyExample("agentic-os-acq-")
  process.env.AGENTIC_OS_BACKOFF_MS = "1" // no real sleeping in tests
  let calls = 0
  const events: { kind: string; payload: Record<string, unknown> }[] = []
  const logs: string[] = []
  try {
    const hooks = {
      ...hooksFromDir(dir).hooks,
      units: () => {
        calls += 1
        if (calls < 3) throw new RefusedError("429 rate limited")
        return [{ id: "a", brief: "do a" }]
      },
    }
    const units = acquireUnits(dir, hooks, {
      log: (m) => logs.push(m),
      emit: (kind, payload) => events.push({ kind, payload }),
    })
    assert.equal(units.length, 1)
    assert.equal(calls, 3)
    assert.equal(events.length, 2)
    assert.equal(events[0]!.kind, "backpressure")
    assert.match(logs[0]!, /planner refused/)
    // the units file landed: a second acquisition never calls the hook
    const again = acquireUnits(dir, { ...hooks, units: () => { calls += 1; return [] } })
    assert.equal(again.length, 1)
    assert.equal(calls, 3)
  } finally {
    delete process.env.AGENTIC_OS_BACKOFF_MS
  }
})

test("acquireUnits fails fast on a deterministic planner failure", async () => {
  const dir = await copyExample("agentic-os-acq-")
  let calls = 0
  const hooks = {
    ...hooksFromDir(dir).hooks,
    units: () => {
      calls += 1
      throw new HookError("units hook exited 1: bad prompt")
    },
  }
  assert.throws(() => acquireUnits(dir, hooks, {}), /bad prompt/)
  assert.equal(calls, 1)
})

test("a reprompted worker that then writes its sentinel finished_by normally", async () => {
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
  const finished = cycle(base)   // reprompt fires here, sentinels land
  const done = cycle(base)      // next poll finished_by them

  assert.equal(finished, false)
  assert.equal(done, true)
  assert.deepEqual(readState(dir).done, ["france", "japan", "peru"])
  assert.deepEqual(wakes.filter((w) => w.kind === "blocked"), [])
})

test("cycle skips units already finished", async () => {
  const dir = await copyExample("orch-resume-")
  settle(dir, "france", "unit:france", true, "found")
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

test("a unit whose spawn fails three times finished_by failed and wakes", async () => {
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

test("runOrchestrator wakes on the log, not on the check interval", async () => {
  const dir = await copyExample("orch-idle-")
  const { port } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "capital\n")
      appendFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
  })
  const report = await Promise.race([
    runOrchestrator({ taskDir: dir, shep: port, checkMs: 60_000, log: () => {} }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("still polling")), 2000)),
  ])
  assert.equal(report.status, "done")
})

// j-ba18b7: the worker appended its done line and fs.watch never fired —
// the rail sat blind until a 10-minute stall timer. The done below lands
// as a fresh inode (rename), so every file watcher is blind to it; only
// the log poller's stat sweep can see it.
test("a done-append no watcher can see still finished_by via the log poller", async () => {
  const dir = await copyExample("orch-poll-")
  const { port } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      appendFileSync(join(cwd, "log.txt"), `progress ${name.slice(2)} started\n`)
      return true
    },
  })
  const engine = runOrchestrator({
    taskDir: dir,
    shep: port,
    slots: 3,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    logPollMs: 100,
    log: () => {},
  })
  // let every flight spawn, then land the dones where no watcher sees them
  await new Promise((resolve) => setTimeout(resolve, 300))
  const ids = readFileSync(join(dir, "units.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { id: string }).id)
  for (const id of ids) {
    writeFileSync(join(dir, "units", id, "result.md"), "capital\n")
    const staged = join(dir, "units", id, "log.txt.staged")
    writeFileSync(staged, `progress ${id} started\ndone ${id}\n`)
    renameSync(staged, join(dir, "units", id, "log.txt"))
  }
  const report = await Promise.race([
    engine,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("poller did not fire")), 4000)),
  ])
  assert.equal(report.status, "done")
  assert.deepEqual(report.counts, { lookups: 3, failed: 0 })
})

test("runOrchestrator finished_by everything, writes the report, and quotes the receipt", async () => {
  const dir = await copyExample("orch-full-")
  const { port, wakes, calls, retired } = fakeShep({
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
})

test("hook runs land in the trace as hook.run (issue #40)", async () => {
  const dir = await copyExample("orch-hookruns-")
  const { port } = fakeShep({
    spawnWorker: (name, _kind, _brief, cwd) => {
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "capital\n")
      appendFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
  })
  const hookRuns: { hook: string; target?: string; status: number; ms: number }[] = []
  const report = await runOrchestrator({
    taskDir: dir,
    shep: port,
    checkMs: 10,
    log: () => {},
    emit: (kind, payload) => {
      if (kind === "hook.run") hookRuns.push(payload as { hook: string; target?: string; status: number; ms: number })
    },
  })
  assert.equal(report.status, "done")
  const names = hookRuns.map((h) => h.hook)
  assert.equal(names.filter((n) => n === "grade").length, 3, "grade reported per finished unit")
  assert.ok(names.includes("counts"), "counts reported at report time")
  const one = hookRuns.find((h) => h.hook === "grade")
  assert.ok(one?.target, "grade notes its target unit")
  assert.equal(one.status, 0)
  assert.ok(one.ms >= 0)
})

test("runOrchestrator stops at the deadline, finished_by the rest failed, and wakes", async () => {
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

test("a permission dialog the rail answers does not stall the unit (zen 6)", async () => {
  const dir = await copyExample("orch-permission-")
  const shep = fakeShep({
    tickPrivilege: () => ({ answered: new Set(["w-france"]), capped: new Set<string>() }),
  })

  const d = deps(dir, shep.port, { stallMs: 10, now: () => 1_000_000 })
  cycle(d) // spawns w-france — the sweep ran before the spawn, nothing answered yet
  cycle(d) // dialog seen by the sweep — the unit stays open, nothing finished_by

  assert.deepEqual(shep.retired, [])
  assert.deepEqual(shep.wakes, [])
  assert.deepEqual(readState(dir), { done: [], failed: [] })
  assert.equal(d.inFlight.has("france"), true)
})

test("a worker past the permission cap finished_by blocked with a wake that says so", async () => {
  const dir = await copyExample("orch-perm-cap-")
  const shep = fakeShep({
    tickPrivilege: () => ({ answered: new Set(["w-france"]), capped: new Set(["w-france"]) }),
  })

  const d = deps(dir, shep.port, { slots: 1 })
  cycle(d) // spawn
  cycle(d) // capped — finished_by like a block

  assert.deepEqual(readState(dir).failed, ["france"])
  assert.deepEqual(shep.retired, ["w-france"])
  assert.equal(shep.wakes.length, 1)
  assert.match(shep.wakes[0]!.detail, /permission deny cap/)
})

test("every cycle sweeps privileges — the rail answers, the engine carries the consequence (j-2b508e)", async () => {
  const dir = await copyExample("orch-note-flush-")
  let sweeps = 0
  const shep = fakeShep({
    tickPrivilege: () => {
      sweeps += 1
      return { answered: new Set<string>(), capped: new Set<string>() }
    },
  })
  const d = deps(dir, shep.port, { slots: 1 })
  cycle(d) // spawn
  cycle(d) // a beat with a pane in flight
  assert.ok(sweeps >= 2, `the engine swept on every cycle (got ${sweeps})`)
})

// #144 — a grade FAULT is infra, never an answer: it cannot trip the
// canary (the gate judges plans, not hooks), it lands on the stage
// ledger as a regradable card, and a failing grade that says nothing
// is labeled a fault, not a verdict.

test("a grade-fault never trips the canary and lands as a ledger card (#144)", async () => {
  const dir = await copyExample("orch-grade-fault-")
  const shep = fakeShep()
  const canaryState = { enabled: true, released: false, failed: false }
  const base = deps(dir, shep.port, { canary: canaryState, slots: 3 })
  const realGrade = base.hooks.grade
  base.hooks = {
    ...base.hooks,
    grade: (unit) =>
      unit.id === "france"
        ? { pass: false, row: "grade-fault: exit 127", fault: "grade-fault" }
        : realGrade(unit),
  }
  cycle(base) // spawn france (canary cap 1)
  appendFileSync(join(dir, "units", "france", "log.txt"), "done france\n")
  cycle(base) // france finishes; grade faults
  assert.equal(canaryState.failed, false, "a grade-fault must not stop the line")
  const cps = readCheckpoints(dir)
  assert.ok(cps.some((c) => c.stage === "grade:france" && c.status === "grade-fault"), "the ledger has the fault card")
  assert.ok(cps.some((c) => c.stage === "unit:france" && c.status === "info"), "the worker card observes (info) — only the grade card settles")
})

test("a grade that throws is a fault too: no canary trip, a ledger card, a wake (#144)", async () => {
  const dir = await copyExample("orch-grade-throw-fault-")
  const { port, wakes } = fakeShep()
  const canaryState = { enabled: true, released: false, failed: false }
  const base = deps(dir, port, { canary: canaryState, slots: 3 })
  const realGrade = base.hooks.grade
  base.hooks = {
    ...base.hooks,
    grade: (unit) => {
      if (unit.id === "france") throw new HookError("hook timed out after 300000ms")
      return realGrade(unit)
    },
  }
  cycle(base)
  appendFileSync(join(dir, "units", "france", "log.txt"), "done france\n")
  cycle(base)
  assert.equal(canaryState.failed, false, "a thrown grade is infra — the canary stays untouched")
  const cps = readCheckpoints(dir)
  assert.ok(cps.some((c) => c.stage === "grade:france" && c.status === "grade-fault"))
  assert.ok(wakes.some((w) => w.detail.includes("grade error")))
})

test("a REAL answer fail still trips the canary — the immunity is for faults only", async () => {
  const dir = await copyExample("orch-canary-real-fail-")
  const shep = fakeShep()
  const canaryState = { enabled: true, released: false, failed: false }
  const base = deps(dir, shep.port, { canary: canaryState, slots: 3 })
  const realGrade = base.hooks.grade
  base.hooks = {
    ...base.hooks,
    grade: (unit) => (unit.id === "france" ? { pass: false, row: "FAIL" } : realGrade(unit)),
  }
  cycle(base)
  appendFileSync(join(dir, "units", "france", "log.txt"), "done france\n")
  cycle(base)
  assert.equal(canaryState.failed, true, "a loud FAIL is an answer fail — the gate trips")
  const cps = readCheckpoints(dir)
  assert.ok(cps.some((c) => c.stage === "grade:france" && c.status === "FAILED"))
})

test("a failed spawn arms a near-term retry wake — never the stall ladder (#165, j-214576)", async () => {
  const dir = await copyExample("orch-canary-stop-")
  const shep = fakeShep({ spawnWorker: () => false })
  const retries: { unit: string; attempts: number }[] = []
  const d = deps(dir, shep.port, { onSpawnRetry: (unitId, attempts) => retries.push({ unit: unitId, attempts }) })
  cycle(d)
  const units = shep.spawned.length
  assert.ok(units > 0, "units were attempted")
  assert.deepEqual(retries.map((r) => r.attempts), Array(units).fill(1), "first failure arms a retry, not a block")
  cycle(d)
  assert.deepEqual(retries.slice(units).map((r) => r.attempts), Array(units).fill(2), "second failure re-arms")
  cycle(d)
  assert.deepEqual(retries.slice(2 * units).map((r) => r.attempts), [], "cap reached — no more arming")
  assert.ok(
    shep.wakes.filter((w) => w.kind === "blocked" && w.detail.includes("spawn failed 3 times")).length === units,
    "every unit blocked honestly at the cap"
  )
})
