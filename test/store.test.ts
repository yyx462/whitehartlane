import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_STATE = join(tmpdir(), "agentic-os-test-state")
rmSync(process.env.AGENTIC_OS_STATE, { recursive: true, force: true })

const {
  abortJob,
  appendTrace,
  attachPane,
  createJob,
  finishJob,
  killPane,
  listJobs,
  listSessions,
  loadJob,
  openSession,
  readTrace,
  shortId,
  stateRoot,
} = await import("../src/store.ts")

test("state root honors AGENTIC_OS_STATE", () => {
  assert.equal(stateRoot(), process.env.AGENTIC_OS_STATE)
})

test("a session opens with an id, a record, and no Jobs", () => {
  const session = openSession({ cwd: "/tmp/somewhere" })
  assert.match(session.id, /^s-/)
  assert.ok(existsSync(join(stateRoot(), "sessions", session.id, "session.json")))
  assert.equal(listSessions().length, 1)
  assert.equal(listJobs(session.id).length, 0)
})

test("shortIds do not collide", () => {
  const ids = new Set(Array.from({ length: 50 }, () => shortId("j")))
  assert.equal(ids.size, 50)
})

test("a Job is born running, retires with a receipt, and is never deleted", () => {
  const session = openSession({ cwd: "/tmp/repo" })
  const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "look up capitals", dir: "/tmp/run" })
  assert.equal(job.state, "running")

  attachPane(job, { label: "w-europe-run1", pane: "p1", unit: "europe" })
  attachPane(job, { label: "w-europe-run1", pane: "p1", unit: "europe" }) // idempotent
  attachPane(job, { label: "w-asia-run1", pane: "p2", unit: "asia" })
  assert.equal(job.panes.length, 2)

  killPane(job, "w-europe-run1")
  killPane(job, "w-asia-run1")

  finishJob(job, { panesRemaining: 0, panesTotal: 2, unitsDone: 2, unitsFailed: 0, status: "done" })
  assert.equal(job.state, "retired")
  assert.equal(job.receipt?.panesRemaining, 0)

  const back = loadJob(session.id, job.id)
  assert.equal(back?.state, "retired")
  assert.equal(back?.panes.length, 2)
  assert.ok(existsSync(join(stateRoot(), "sessions", session.id, "jobs", job.id, "job.json")), "record survives retirement (zen 5)")
})

test("abortJob keeps the record with a reason, not a receipt", () => {
  const session = openSession({ cwd: "/tmp/repo2" })
  const job = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: "/tmp/run2", pid: 424242 })
  abortJob(job, "signal SIGTERM", 2)
  const back = loadJob(session.id, job.id)
  assert.equal(back?.state, "aborted")
  assert.equal(back?.abort?.reason, "signal SIGTERM")
  assert.equal(back?.abort?.panesRemaining, 2)
  assert.equal(back?.receipt, undefined)
})

test("the trace is append-only and ordered", () => {
  const session = openSession({ cwd: "/tmp/trace" })
  appendTrace(session.id, { parent: "first_mate", kind: "direct", action: "admit", detail: "direct: hi" })
  const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "t", dir: "/tmp/x" })
  appendTrace(session.id, { jid: job.id, parent: "first_mate", kind: "job", action: "admit", detail: "fan-out: t" })
  appendTrace(session.id, { jid: job.id, parent: "orchestrator", kind: "worker", action: "reject", detail: "w-x: slots full (2/2)" })
  const trace = readTrace(session.id)
  assert.equal(trace.length, 3)
  assert.deepEqual(trace.map((e) => e.action), ["admit", "admit", "reject"])
  assert.equal(trace[2].parent, "orchestrator")
  assert.ok(trace.every((e) => e.ts <= new Date().toISOString()))
})

test("listJobs spans sessions in creation order", () => {
  const s1 = listSessions()[0]
  const s2 = openSession({ cwd: "/tmp/other" })
  createJob({ sid: s1.id, stoodUpBy: "standalone", workflow: "fan-out", task: "a", dir: "/tmp/a" })
  createJob({ sid: s2.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "b", dir: "/tmp/b" })
  const dirs = listJobs().map((job) => job.dir)
  assert.equal(dirs.indexOf("/tmp/a") < dirs.indexOf("/tmp/b"), true, "creation order holds")
  assert.ok(dirs.includes("/tmp/a") && dirs.includes("/tmp/b"))
})
