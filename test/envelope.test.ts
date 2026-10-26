// The run envelope (OPTIMUM §2 slice 2): ONE way to hand a Job to its
// runner process (spawnRunner/rebirthRunner, src/levy.ts), one booked-
// wait (rail.bookedWait), and one kind-blind signal protocol
// (rail.trapSignals + installDrain). These pin the deletions: the four
// hand-rolled spawn sites, the per-engine SIGTERM traps, and the
// coworker booked-wait that filtered by unscoped unit and could never
// match a pane attached under its scoped label.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-envelope-"))
const store = await import("../src/adapters/store.ts")
const { spawnRunner, rebirthRunner, runnerDoor } = await import("../src/adapters/levy.ts")
const { Rail } = await import("../src/adapters/rail.ts")

function stubDoor(home: string): string {
  const stub = join(home, "stub-orchestrator.mjs")
  writeFileSync(
    stub,
    [
      'import { writeFileSync } from "node:fs"',
      'import { join } from "node:path"',
      `const marker = ${JSON.stringify(join(home, "stub-ran"))}`,
      "writeFileSync(marker, `${process.env.AGENTIC_OS_JID}\\n`)",
      "process.exit(0)",
    ].join("\n"),
  )
  return stub
}

test("runnerDoor: env override wins, else the caller's root", () => {
  const was = process.env.AGENTIC_OS_ORCHESTRATOR
  try {
    delete process.env.AGENTIC_OS_ORCHESTRATOR
    assert.equal(runnerDoor("/door-root"), "/door-root/orchestrator")
    process.env.AGENTIC_OS_ORCHESTRATOR = "/pinned/orchestrator"
    assert.equal(runnerDoor("/door-root"), "/pinned/orchestrator")
  } finally {
    if (was !== undefined) process.env.AGENTIC_OS_ORCHESTRATOR = was
    else delete process.env.AGENTIC_OS_ORCHESTRATOR
  }
})

test("spawnRunner: spawns the door with the job booked, pid saved, marker written", async () => {
  const home = process.env.AGENTIC_OS_HOME!
  rmSync(join(home, "stub-ran"), { force: true })
  const stub = stubDoor(home)
  const session = store.openSession({ cwd: home })
  const job = store.createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "envelope",
    dir: mkdtempSync(join(tmpdir(), "envelope-run-")),
  })
  const prev = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_ORCHESTRATOR = stub
  let out: ReturnType<typeof spawnRunner>
  try {
    out = spawnRunner(job, join(import.meta.dirname, "..", "bin"))
  } finally {
    if (prev !== undefined) process.env.AGENTIC_OS_ORCHESTRATOR = prev
    else delete process.env.AGENTIC_OS_ORCHESTRATOR
  }
  assert.ok(out.ok, "ok" in out ? "" : out.why)
  assert.equal(typeof out.pid, "number")
  const reloaded = store.loadJob(job.sid, job.id)
  assert.equal(reloaded?.pid, out.pid)
  // the stub door ran, booked with THIS job's id
  for (let i = 0; i < 50 && !existsSync(join(home, "stub-ran")); i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.equal(readFileSync(join(home, "stub-ran"), "utf8"), `${job.id}\n`)
})

test("spawnRunner: a missing door refuses — nothing spawns, the why names the path", () => {
  const session = store.openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const job = store.createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "envelope-refuse",
    dir: mkdtempSync(join(tmpdir(), "envelope-refuse-")),
  })
  const prev = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_ORCHESTRATOR = join(process.env.AGENTIC_OS_HOME!, "no-such-door")
  try {
    const out = spawnRunner(job, join(import.meta.dirname, "..", "bin"))
    assert.equal(out.ok, false)
    assert.match(!out.ok ? out.why : "", /no orchestrator at/)
    assert.equal(job.pid, undefined)
  } finally {
    if (prev !== undefined) process.env.AGENTIC_OS_ORCHESTRATOR = prev
    else delete process.env.AGENTIC_OS_ORCHESTRATOR
  }
})

test("rebirthRunner: retires the parked generation's stragglers, then books the continue", async () => {
  const home = process.env.AGENTIC_OS_HOME!
  rmSync(join(home, "stub-ran"), { force: true })
  const stub = stubDoor(home)
  const session = store.openSession({ cwd: home })
  const job = store.createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "envelope-rebirth",
    dir: mkdtempSync(join(tmpdir(), "envelope-rebirth-")),
  })
  store.attachPane(job, {
    label: "w-u1",
    unit: "w-u1",
    parent: "orchestrator",
    transcript: { tool: "pi", cwd: "/w", since: new Date().toISOString() },
  })
  store.pauseJob(job, "drained", 1)
  const prev = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_ORCHESTRATOR = stub
  let out: ReturnType<typeof rebirthRunner>
  try {
    out = rebirthRunner(job, join(import.meta.dirname, "..", "bin"))
  } finally {
    if (prev !== undefined) process.env.AGENTIC_OS_ORCHESTRATOR = prev
    else delete process.env.AGENTIC_OS_ORCHESTRATOR
  }
  assert.ok(out.ok, "ok" in out ? "" : out.why)
  const fresh = store.loadJob(job.sid, job.id)!
  assert.equal(fresh.state, "running")
  assert.equal(fresh.continues, 1)
  assert.ok(fresh.panes.every((p) => p.died !== undefined), "every straggler retired")
})

test("rebirthRunner: a live holder refuses at the door — no panes retired, no spawn", async () => {
  const home = process.env.AGENTIC_OS_HOME!
  const stub = stubDoor(home)
  rmSync(join(home, "stub-ran"), { force: true })
  const session = store.openSession({ cwd: home })
  const job = store.createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "envelope-live-holder",
    dir: mkdtempSync(join(tmpdir(), "envelope-live-holder-")),
  })
  store.attachPane(job, {
    label: "w-u1",
    unit: "w-u1",
    parent: "orchestrator",
    transcript: { tool: "pi", cwd: "/w", since: new Date().toISOString() },
  })
  // a LIVE foreign holder (launchd, pid=1, alive by definition)
  store.acquireLease(job, "orchestrator pid=1")
  const prev = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_ORCHESTRATOR = stub
  let out: ReturnType<typeof rebirthRunner>
  try {
    out = rebirthRunner(job, join(import.meta.dirname, "..", "bin"))
  } finally {
    if (prev !== undefined) process.env.AGENTIC_OS_ORCHESTRATOR = prev
    else delete process.env.AGENTIC_OS_ORCHESTRATOR
  }
  assert.equal(out.ok, false)
  assert.match(!out.ok ? out.why : "", /one writer per job/)
  const fresh = store.loadJob(job.sid, job.id)!
  assert.ok(fresh.panes.every((p) => p.died === undefined), "the holder's panes were not retired under it")
  assert.equal(fresh.continues, undefined, "no continue booked")
  assert.equal(existsSync(join(home, "stub-ran")), false, "no runner spawned")
})

test("openLedger: a lease refusal escapes the constructor — the record untouched, the run dies at the door", async () => {
  const home = process.env.AGENTIC_OS_HOME!
  const session = store.openSession({ cwd: home })
  const job = store.createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "envelope-door-refusal",
    dir: mkdtempSync(join(tmpdir(), "envelope-door-refusal-")),
  })
  store.acquireLease(job, "orchestrator pid=1")
  const prevSid = process.env.AGENTIC_OS_SID
  const prevJid = process.env.AGENTIC_OS_JID
  process.env.AGENTIC_OS_SID = session.id
  process.env.AGENTIC_OS_JID = job.id
  try {
    assert.throws(
      () =>
        new Rail({
          log: () => {},
          shepRunner: () => ({ status: 0, stdout: "" }),
          herdrRunner: () => ({ status: 0, stdout: "" }),
        }),
      /LEASE_HELD_BY_LIVE_ORCHESTRATOR/,
    )
    // the refused writer leaves the shared record exactly as it loaded it
    const fresh = store.loadJob(session.id, job.id)!
    assert.equal(fresh.pid, undefined, "no pid stamped before the lock")
    assert.equal(fresh.door, undefined, "no door stamp from a refused writer")
    assert.equal(fresh.lease?.holder, "orchestrator pid=1", "the holder is untouched")
    assert.equal(fresh.lease?.epoch, 1, "a refusal never bumps the epoch")
  } finally {
    if (prevSid !== undefined) process.env.AGENTIC_OS_SID = prevSid
    else delete process.env.AGENTIC_OS_SID
    if (prevJid !== undefined) process.env.AGENTIC_OS_JID = prevJid
    else delete process.env.AGENTIC_OS_JID
  }
})

test("trapSignals is kind-blind: SIGTERM drains through the registered hook, no exit", async () => {
  const rail = new Rail({
    argvDir: mkdtempSync(join(tmpdir(), "envelope-signals-")),
    ledger: null,
    log: () => {},
    shepRunner: () => ({ status: 0, stdout: "" }),
    herdrRunner: () => ({ status: 0, stdout: "" }),
  })
  let drained = 0
  rail.installDrain(() => {
    drained += 1
  })
  rail.trapSignals()
  try {
    process.kill(process.pid, "SIGTERM")
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(drained, 1)
    // the hook STAYS registered — a second TERM re-enters the drain
    process.kill(process.pid, "SIGTERM")
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(drained, 2)
  } finally {
    process.removeAllListeners("SIGTERM")
    process.removeAllListeners("SIGINT")
  }
})
