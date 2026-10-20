// v8 — ADR 0008: the in-band wake spool. An opencode levy that is not
// a pane gets its wake IN-BAND: the rail appends a row addressed to
// the booked session id, the agentic-wake plugin (riding the levy's
// own opencode process) drains it into the conversation. The plugin's
// heartbeat (alive.json) is the trust: fresh means someone listens
// in-band and the doorbell stays silent; stale or absent falls to the
// doorbell exactly as before. Pure reader halves (rowsBeyond, digest)
// live in the plugin file itself — imported here so the two halves
// cannot drift apart.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { rowsBeyond, digest } from "../plugin/opencode-wake.js"
import { appendSpoolWake, spoolAlive, spoolDirOf } from "../src/adapters/wake-spool.ts"
import { createJob, readEvents, wakeFirstMate } from "../src/adapters/store.ts"

const HOME = mkdtempSync(join(tmpdir(), "aos-spool-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"
// the spool rung is config-off by default (AGENTIC_OS_SPOOL_WAKE);
// this file tests the channel itself, so it arms the rung
process.env.AGENTIC_OS_SPOOL_WAKE = "1"

test.after(() => rmSync(HOME, { recursive: true, force: true }))

// ---- the pure reader half (shared with the plugin via import) ----

test("rowsBeyond: offsets advance only past newlines; torn tails wait; bad lines are consumed", () => {
  const one = JSON.stringify({ to: "s1", jid: "j-1", text: "a" }) + "\n"
  const two = JSON.stringify({ to: "s1", jid: "j-2", text: "b" }) + "\n"
  const torn = JSON.stringify({ to: "s1", jid: "j-3", text: "c" }).slice(0, 10)
  const text = one + two + "{not json}\n" + torn
  const first = rowsBeyond(text, 0)
  assert.equal(first.rows.length, 2, "two whole rows; the malformed line is consumed, the torn tail waits")
  assert.equal(first.rows[0].jid, "j-1")
  assert.equal(first.rows[1].jid, "j-2")
  const second = rowsBeyond(text, first.end)
  assert.equal(second.rows.length, 0, "a torn tail re-reads as nothing")
  const whole = JSON.stringify({ to: "s1", jid: "j-3", text: "c" })
  const healed = text + whole.slice(torn.length) + "\n" // the append completes: the row's bytes arrive, then the newline
  const third = rowsBeyond(healed, first.end)
  assert.equal(third.rows.length, 1, "once the newline lands, the row delivers")
  assert.equal(third.rows[0].jid, "j-3")
})

test("digest: one wake turn, jid-first lines", () => {
  const text = digest([{ jid: "j-9", text: "done — check report" }])
  assert.ok(text.startsWith("[agentic-wake]"))
  assert.match(text, /- j-9: done — check report/)
})

// ---- the writer half ----

test("appendSpoolWake lands one jsonl row per levy session dir", () => {
  const ok = appendSpoolWake({ at: "t0", to: "ses_spoolA", jid: "j-a", text: "wake a" })
  assert.equal(ok, true)
  const line = readFileSync(join(spoolDirOf("ses_spoolA"), "queue.jsonl"), "utf8")
  assert.deepEqual(JSON.parse(line), { at: "t0", to: "ses_spoolA", jid: "j-a", text: "wake a" })
})

test("spoolAlive: fresh heartbeat yes, stale no, absent no", () => {
  const dir = spoolDirOf("ses_beat")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "alive.json"), JSON.stringify({ pid: 1, at: Date.now() - 60_000 }))
  assert.equal(spoolAlive("ses_beat"), true, "a minute old is fresh")
  writeFileSync(join(dir, "alive.json"), JSON.stringify({ pid: 1, at: Date.now() - 16 * 60_000 }))
  assert.equal(spoolAlive("ses_beat"), false, "sixteen minutes old is stale")
  assert.equal(spoolAlive("ses_never"), false, "no dir at all is not alive")
})

// ---- the ladder rung, proved on a fixture OS disk ----

const SPAWNER = { tool: "opencode", session_id: "ses_levychat", since: "2026-10-10T00:00:00.000Z" }

function leviedChild(task: string) {
  return createJob({
    sid: "s-spooltest",
    stoodUpBy: "levy",
    workflow: "coworker",
    task,
    runDir: true,
    spawner: SPAWNER,
  })
}

test("a chat levy with a fresh heartbeat wakes in-band; the doorbell stays silent", () => {
  mkdirSync(spoolDirOf(SPAWNER.session_id), { recursive: true })
  writeFileSync(join(spoolDirOf(SPAWNER.session_id), "alive.json"), JSON.stringify({ pid: 42, at: Date.now() }))
  const job = leviedChild("in-band wake me")
  const notifications: string[] = []
  wakeFirstMate(job, "done", null, { notify: (t) => notifications.push(t) })
  assert.equal(job.woke?.delivery, "inband")
  assert.equal(job.woke?.to, SPAWNER.session_id)
  assert.equal(notifications.length, 0, "in-band took it — no doorbell")
  const q = readFileSync(join(spoolDirOf(SPAWNER.session_id), "queue.jsonl"), "utf8")
  assert.match(q, /in-band wake me/, "the row carries the wake text")
  const ev = readEvents("s-spooltest").find((e) => e.kind === "job.woke")
  assert.equal(ev?.delivery, "inband", "the trace books the rung")
})

test("a stale heartbeat falls to the doorbell — nothing is trusted blindly", () => {
  mkdirSync(spoolDirOf(SPAWNER.session_id), { recursive: true })
  writeFileSync(join(spoolDirOf(SPAWNER.session_id), "alive.json"), JSON.stringify({ pid: 42, at: Date.now() - 20 * 60_000 }))
  const job = leviedChild("doorbell me")
  const notifications: string[] = []
  wakeFirstMate(job, "done", null, { notify: (t) => notifications.push(t) })
  assert.equal(job.woke?.delivery, "doorbell")
  assert.equal(notifications.length, 1)
})

test("no heartbeat at all (plugin never installed): doorbell, as before", () => {
  rmSync(spoolDirOf(SPAWNER.session_id), { recursive: true, force: true })
  const job = leviedChild("classic path")
  const notifications: string[] = []
  wakeFirstMate(job, "done", null, { notify: (t) => notifications.push(t) })
  assert.equal(job.woke?.delivery, "doorbell")
  assert.equal(notifications.length, 1)
})

test("a rail spawner is never spooled nor doorbelled — wake.json is the receipt", () => {
  const job = createJob({
    sid: "s-spooltest2",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child program",
    runDir: true,
    spawner: { tool: "rail", session_id: "rail-w2", since: "2026-10-10T00:00:00.000Z" },
  })
  mkdirSync(spoolDirOf("rail-w2"), { recursive: true })
  writeFileSync(join(spoolDirOf("rail-w2"), "alive.json"), JSON.stringify({ pid: 1, at: Date.now() }))
  const notifications: string[] = []
  wakeFirstMate(job, "done", null, { notify: (t) => notifications.push(t) })
  assert.equal(job.woke?.delivery, "queued")
  assert.equal(notifications.length, 0)
  assert.equal(existsSync(join(spoolDirOf("rail-w2"), "queue.jsonl")), false, "machines are not spooled")
})
