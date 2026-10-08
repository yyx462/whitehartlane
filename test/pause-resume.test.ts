import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  acquireUnits,
  continueBriefFor,
  cycle,
  drainDeadline,
  runOrchestrator,
  type CycleDeps,
  type ResumePointer,
  type ShepPort,
} from "../src/orchestrator.ts"
import { hooksFromDir } from "../src/hooks.ts"
import { readState } from "../src/state.ts"
import { copyExample } from "./util.ts"

function fakeShep(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  const spawned: string[] = []
  const resumed: { name: string; session: ResumePointer; briefPath: string }[] = []
  const retired: string[] = []
  const calls: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name, kind, briefPath, cwd) => {
      spawned.push(name)
      const fn = overrides.spawnWorker as ShepPort["spawnWorker"] | undefined
      return fn ? fn(name, kind, briefPath, cwd) : true
    },
    resumeWorker: (name, session, briefPath, cwd) => {
      resumed.push({ name, session, briefPath })
      const fn = overrides.resumeWorker as ShepPort["resumeWorker"] | undefined
      return fn ? fn(name, session, briefPath, cwd) : true
    },
    paneAlive: (overrides.paneAlive as ShepPort["paneAlive"]) ?? (() => true),
    reprompt: () => true,
    retire: (name) => {
      retired.push(name)
    },
    retireAll: () => {
      calls.push("retireAll")
    },
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tailPane: () => true,
  }
  return { port, spawned, resumed, retired, calls }
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

function unitIds(dir: string): string[] {
  return readFileSync(join(dir, "units.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { id: string }).id)
}

async function copyExampleWithUnits(prefix: string): Promise<string> {
  const dir = await copyExample(prefix)
  acquireUnits(dir, hooksFromDir(dir).hooks, { log: () => {}, emit: () => {} })
  return dir
}

test("draining claims no new units", async () => {
  const dir = await copyExampleWithUnits("pause-drain-")
  const { port, spawned } = fakeShep()
  const done = cycle(deps(dir, port, { draining: true }))
  assert.equal(spawned.length, 0)
  assert.equal(done, false)
})

test("draining still settles an in-flight unit that finishes", async () => {
  const dir = await copyExampleWithUnits("pause-settle-")
  const { port, spawned } = fakeShep()
  const d = deps(dir, port)
  cycle(d)
  assert.ok(spawned.length > 0)
  const [name] = spawned
  writeFileSync(join(dir, "units", name.slice(2), "result.md"), "Paris\n")
  writeFileSync(join(dir, "units", name.slice(2), "log.txt"), `done ${name.slice(2)}\n`)
  const before = spawned.length
  const done = cycle(deps(dir, port, { draining: true, inFlight: d.inFlight }))
  const state = readState(dir)
  assert.ok(state.done.includes(name.slice(2)))
  // the freed slot is not refilled while draining
  assert.equal(spawned.length, before)
  assert.equal(done, false)
})

test("draining leaves a dead pane's unit open for resume — no failed settle", async () => {
  const dir = await copyExampleWithUnits("pause-dead-")
  const alive = fakeShep()
  const dead = fakeShep({ paneAlive: () => false })
  const d = deps(dir, alive.port)
  cycle(d)
  const [name] = alive.spawned
  cycle(deps(dir, dead.port, { draining: true, inFlight: d.inFlight }))
  const state = readState(dir)
  assert.equal(state.done.includes(name.slice(2)), false)
  assert.equal(state.failed.includes(name.slice(2)), false)
  assert.ok(dead.retired.includes(name))
  assert.equal(d.inFlight.has(name.slice(2)), false)
})

test("a parked unit resumes through resumeWorker with a continue brief", async () => {
  const dir = await copyExampleWithUnits("pause-resume-")
  const { port, spawned, resumed } = fakeShep()
  const session: ResumePointer = { tool: "pi", session_id: "abc-123", cwd: dir }
  const id = unitIds(dir)[0]
  cycle(deps(dir, port, { resumes: new Map([[id, session]]) }))
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0].name, `w-${id}`)
  assert.equal(resumed[0].session.session_id, "abc-123")
  assert.match(readFileSync(resumed[0].briefPath, "utf8"), /pick up exactly where you left off/)
  // the resumed unit did not go through the fresh-spawn path
  assert.ok(spawned.every((name) => name !== `w-${id}`))
})

test("without resumeWorker the continue brief goes to a fresh spawn", async () => {
  const dir = await copyExampleWithUnits("pause-fallback-")
  const { port } = fakeShep()
  const briefs = new Map<string, string>()
  const fresh = { ...port } as ShepPort
  fresh.resumeWorker = undefined
  fresh.spawnWorker = (name, kind, briefPath) => {
    briefs.set(name, readFileSync(briefPath, "utf8"))
    return true
  }
  const id = unitIds(dir)[0]
  cycle(deps(dir, fresh, { resumes: new Map([[id, { tool: "pi", cwd: dir }]]) }))
  const brief = briefs.get(`w-${id}`)
  assert.ok(brief)
  assert.match(brief, /could not be resumed/)
  assert.match(brief, /take the work over/)
})

test("drainDeadline honors the one-shot file, then clears it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pause-deadline-"))
  const at = new Date(Date.now() + 5_000).toISOString()
  writeFileSync(join(dir, "drain.deadline"), at)
  assert.equal(drainDeadline(dir, 1_000, 60_000), Date.parse(at))
  assert.equal(existsSync(join(dir, "drain.deadline")), false)
  // no file: the configured ceiling
  const now = Date.now()
  assert.ok(Math.abs(drainDeadline(dir, now, 60_000) - (now + 60_000)) < 5)
  // garbage: the ceiling, and the junk file is cleared
  writeFileSync(join(dir, "drain.deadline"), "not a date")
  assert.ok(Math.abs(drainDeadline(dir, now, 30_000) - (now + 30_000)) < 5)
  assert.equal(existsSync(join(dir, "drain.deadline")), false)
})

test("runOrchestrator parks on SIGTERM: drained units settle, stragglers stay open, no report", async () => {
  const dir = await copyExampleWithUnits("pause-loop-")
  const spawnedOnce = new Set<string>()
  const { port, retired, calls } = fakeShep({
    spawnWorker: (name) => {
      if (spawnedOnce.has(name)) return true
      spawnedOnce.add(name)
      if (spawnedOnce.size === 1) {
        const unitId = String(name).slice(2)
        writeFileSync(join(dir, "units", unitId, "result.md"), "Paris\n")
        writeFileSync(join(dir, "units", unitId, "log.txt"), `done ${unitId}\n`)
      }
      return true
    },
  })
  const running = runOrchestrator({
    taskDir: dir,
    shep: port,
    slots: 2,
    checkMs: 40,
    drainMs: 250,
    log: () => {},
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  process.kill(process.pid, "SIGTERM")
  const report = await running
  assert.equal(report, null)
  const state = readState(dir)
  assert.equal(state.done.length, 1)
  assert.equal(state.failed.length, 0)
  // the hanging unit(s) were retired UNSETTLED — open for a resumed session
  assert.ok(retired.some((name) => !state.done.includes(name.slice(2))))
  assert.ok(calls.includes("retireAll"))
  assert.equal(existsSync(join(dir, "report.json")), false)
})

test("continueBriefFor restates the settle protocol for both resume shapes", () => {
  const paths = { dir: "/d", briefPath: "/d/brief.md", logPath: "/d/log.txt" }
  const withSession = continueBriefFor({ id: "u9", brief: "b" }, { tool: "pi", session_id: "s1", cwd: "/w" }, paths)
  assert.match(withSession, /done u9/)
  assert.match(withSession, /blocked u9/)
  const takeover = continueBriefFor({ id: "u9", brief: "b" }, { tool: "pi", cwd: "/w" }, paths)
  assert.match(takeover, /could not be resumed/)
})

test("the store books pause, continue, and pane sessions — and the trace replays them", async () => {
  process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-pause-store-"))
  const { attachPane, continueJob, createJob, openSession, pauseJob, projectJob, setPaneSession } =
    await import("../src/store.ts")
  const sess = openSession({ cwd: "/tmp/r" })
  const job = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: "/tmp/r/j" })
  attachPane(job, {
    label: "w-u1",
    unit: "u1",
    parent: "orchestrator",
    transcript: { tool: "pi", cwd: "/w", since: new Date().toISOString() },
  })
  setPaneSession(job, "w-u1", "sess-7")
  assert.equal(job.panes[0].transcript?.session_id, "sess-7")

  pauseJob(job, "drained", 0)
  assert.equal(job.state, "paused")
  assert.equal(job.finished, undefined)
  assert.ok(job.pause)

  continueJob(job, 4242)
  assert.equal(job.state, "running")
  assert.equal(job.continues, 1)
  assert.equal(job.pause, undefined)

  const replay = projectJob(sess.id, job.id)
  assert.ok(replay)
  assert.equal(replay?.state, "running")
  assert.equal(replay?.continues, 1)
  assert.equal(replay?.panes[0].transcript?.session_id, "sess-7")

  // a pause that lands last wins the replayed state
  pauseJob(job, "drained again", 0)
  assert.equal(projectJob(sess.id, job.id)?.state, "paused")
})
