// The wake rung trace (the 2026-10-12 p10 lesson): every rung attempt —
// taken, refused, skipped — must record WHY on job.woke.rungs, in the
// session trail, and in the job's orchestrator.log. All four in-band
// rungs once failed silently and the wake fell to the doorbell with
// nothing to show for it; these tests pin the opposite. Plus the fail
// button (failJob): the deterministic entry that marks a spur failed
// and fires the ladder on demand.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { registerLevyPane } from "../src/levy-pane.ts"
import { createJob, failJob, pauseJob, readEvents, wakeFirstMate, type JobRecord } from "../src/store.ts"
import { spoolDirOf } from "../src/wake-spool.ts"

const HOME = mkdtempSync(join(tmpdir(), "aos-rungtrace-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"
delete process.env.AGENTIC_OS_SPOOL_WAKE

test.after(() => rmSync(HOME, { recursive: true, force: true }))

const SPAWNER = { tool: "opencode", session_id: "ses_trace", since: "2026-10-12T00:00:00.000Z" }

function levied(sid: string, task = "trace probe"): JobRecord {
  return createJob({ sid, stoodUpBy: "levy", workflow: "coworker", task, runDir: true, spawner: SPAWNER })
}

function resetLadders() {
  rmSync(join(HOME, "levy-panes"), { recursive: true, force: true })
  rmSync(join(HOME, "wake-spool"), { recursive: true, force: true })
}

function bells() {
  const notifications: string[] = []
  return { notifications, port: { notify: (t: string) => { notifications.push(t) } } }
}

function rung(job: JobRecord, name: string) {
  return job.woke?.rungs?.find((r) => r.rung === name)
}

test("spool rung is config-off by default — a fresh heartbeat alone does not arm it, and the trace says so", () => {
  resetLadders()
  mkdirSync(spoolDirOf(SPAWNER.session_id), { recursive: true })
  writeFileSync(join(spoolDirOf(SPAWNER.session_id), "alive.json"), JSON.stringify({ pid: 7, at: Date.now() }))
  const job = levied("s-tr1")
  const { notifications, port } = bells()
  wakeFirstMate(job, "failed", null, { promptPane: () => false, ...port })
  assert.equal(job.woke?.delivery, "doorbell")
  assert.match(rung(job, "spool")?.why ?? "", /off by config/)
  assert.equal(existsSync(join(spoolDirOf(SPAWNER.session_id), "queue.jsonl")), false, "nothing spooled while disarmed")
  assert.equal(notifications.length, 1)
})

test("an armed spool (AGENTIC_OS_SPOOL_WAKE=1) takes the wake in-band", () => {
  resetLadders()
  const prev = process.env.AGENTIC_OS_SPOOL_WAKE
  process.env.AGENTIC_OS_SPOOL_WAKE = "1"
  try {
    mkdirSync(spoolDirOf(SPAWNER.session_id), { recursive: true })
    writeFileSync(join(spoolDirOf(SPAWNER.session_id), "alive.json"), JSON.stringify({ pid: 7, at: Date.now() }))
    const job = levied("s-tr2")
    const { notifications, port } = bells()
    wakeFirstMate(job, "done", null, { promptPane: () => false, ...port })
    assert.equal(job.woke?.delivery, "inband")
    assert.equal(rung(job, "spool")?.ok, true)
    assert.equal(notifications.length, 0)
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_SPOOL_WAKE
    else process.env.AGENTIC_OS_SPOOL_WAKE = prev
  }
})

test("the fork's why lands in the trace — a refused rebirth is never silent again", () => {
  resetLadders()
  const job = levied("s-tr3")
  const { port } = bells()
  wakeFirstMate(job, "failed", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: false, why: "the seed does not resolve — no session file for ses_trace" }),
    ...port,
  })
  assert.equal(job.woke?.delivery, "doorbell")
  assert.match(rung(job, "fork")?.why ?? "", /seed does not resolve/)
})

test("a registered pane that is not alive says so by name", () => {
  resetLadders()
  registerLevyPane({ session_id: SPAWNER.session_id, tool: "opencode", pane: "wT:p1", at: new Date().toISOString() })
  const job = levied("s-tr4")
  const { port } = bells()
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    paneAlive: () => false,
    forkLevy: () => ({ ok: false, why: "x" }),
    ...port,
  })
  assert.match(rung(job, "registered-pane")?.why ?? "", /wT:p1 is not alive/)
})

test("every rung attempt lands in the session trail and the job's orchestrator.log", () => {
  resetLadders()
  const job = levied("s-tr5")
  const { port } = bells()
  wakeFirstMate(job, "failed", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: false, why: "herdr down" }),
    ...port,
  })
  const kinds = readEvents("s-tr5").filter((e) => e.kind === "wake.rung").map((e) => e.rung)
  assert.deepEqual(kinds, ["worker-pane", "registered-pane", "fork", "spool", "doorbell"])
  const log = readFileSync(join(job.dir, "orchestrator.log"), "utf8")
  assert.match(log, /wake rung worker-pane no — no live worker pane holds session ses_trace/)
  assert.match(log, /wake rung fork no — fork refused: herdr down/)
  assert.match(log, /wake rung spool no — off by config/)
  assert.match(log, /wake rung doorbell/)
})

test("the disarmed fork records why it never ran (test context / env hatch)", () => {
  resetLadders()
  const job = levied("s-tr6")
  const { port } = bells()
  wakeFirstMate(job, "done", null, { promptPane: () => false, ...port })
  assert.match(rung(job, "fork")?.why ?? "", /disarmed/)
})

test("the fail button: a paused Job is marked failed and the ladder fires with the reason", () => {
  resetLadders()
  const job = levied("s-tr7", "fail-button me")
  pauseJob(job, "test setup", 0)
  const { notifications, port } = bells()
  const failed = failJob(job, "relay refused everything", { port })
  assert.ok(failed, "a non-running job accepts the button")
  assert.equal(failed.receipt?.status, "failed")
  const report = readFileSync(failed.receipt!.report!, "utf8")
  assert.match(report, /fail-button/)
  assert.match(failed.woke?.message ?? "", /failed \(fail-button: relay refused everything\)/)
  assert.ok(readEvents("s-tr7").some((e) => e.kind === "job.fail-button"))
  assert.equal(notifications.length, 1)
})

test("the fail button refuses a running Job and an already-woke one (unless again)", () => {
  resetLadders()
  const live = levied("s-tr8")
  assert.equal(failJob(live, "nope"), null, "abort owns live jobs")

  const job = levied("s-tr8b")
  pauseJob(job, "test setup", 0)
  const { notifications, port } = bells()
  assert.ok(failJob(job, "first", { port }))
  assert.equal(failJob(job, "second", { port }), null, "the once-guard holds after a wake")
  assert.ok(failJob(job, "second", { again: true, port }), "again re-fires the ladder for testing")
  assert.equal(notifications.length, 2)
  assert.equal(readEvents("s-tr8b").filter((e) => e.kind === "job.fail-button").length, 2)
})

test("the fail button never clobbers a real report", () => {
  resetLadders()
  const job = levied("s-tr9")
  pauseJob(job, "test setup", 0)
  const real = join(job.dir, "report.json")
  mkdirSync(job.dir, { recursive: true })
  writeFileSync(real, JSON.stringify({ kind: "report", status: "failed", table: [{ unit: "sales", result: "real run" }] }))
  const { port } = bells()
  const failed = failJob(job, "button", { port })
  assert.equal(failed?.receipt?.report, real)
  assert.match(readFileSync(real, "utf8"), /real run/, "the real report survives")
})
