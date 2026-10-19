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
const store = await import("../src/store.ts")
const { spawnRunner, rebirthRunner, runnerDoor } = await import("../src/levy.ts")
const { Rail } = await import("../src/rail.ts")

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

test("rail.bookedWait: one spelling, label-scoped — the member drift is gone", async () => {
  const home = process.env.AGENTIC_OS_HOME!
  const dir = mkdtempSync(join(tmpdir(), "envelope-rail-"))
  const mkRail = (ledger: unknown) =>
    new Rail({
      argvDir: dir,
      ledger: ledger as never,
      log: () => {},
      shepRunner: () => ({ status: 0, stdout: "" }),
      herdrRunner: () => ({ status: 0, stdout: "" }),
    })
  assert.equal(mkRail(null).bookedWait("alex"), false, "no ledger → never booked")
  // a ledger whose only pane is attached under the SCOPED label — the
  // shape inhabitPane books for every member and worker
  const mkLedger = () => {
    const ledger = {
      job: store.createJob({
        sid: store.openSession({ cwd: home }).id,
        stoodUpBy: "standalone",
        workflow: "coworker",
        task: "bw",
        dir,
      }),
      renew: () => {},
      emit: () => {},
      attach: () => {},
      kill: () => {},
      finish: () => {},
      abort: () => {},
      pause: () => {},
      setSession: () => {},
    } as never
    return ledger as { job: { panes: unknown[] } } & Record<string, unknown>
  }
  const paneOn = (rail: InstanceType<typeof Rail>, ledger: ReturnType<typeof mkLedger>, sid: string) => {
    const label = rail.scopedName("alex")
    ledger.job.panes = [
      {
        label,
        pane: "p1",
        unit: label,
        born: new Date().toISOString(),
        transcript: { tool: "opencode", cwd: dir, since: new Date().toISOString(), session_id: sid },
      },
    ]
  }
  // no live spawner names the session → not booked
  const quiet = mkLedger()
  const quietRail = mkRail(quiet)
  paneOn(quietRail, quiet, "ses_quiet")
  assert.equal(quietRail.bookedWait("alex"), false)
  // a running child job names the session as spawner → booked (ADR
  // 0006). The lookup memoizes briefly (10s TTL) — a fresh rail (and
  // its own fresh label, as a new generation would book) sees the fact.
  const child = store.createJob({
    sid: store.openSession({ cwd: home }).id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "child",
    dir: mkdtempSync(join(tmpdir(), "envelope-child-")),
  })
  child.spawner = { tool: "opencode", session_id: "ses_live", since: new Date().toISOString() }
  store.saveJob(child)
  const busy = mkLedger()
  const busyRail = mkRail(busy)
  paneOn(busyRail, busy, "ses_live")
  assert.equal(busyRail.bookedWait("alex"), true)
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
