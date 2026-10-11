// ADR 0007 stage 3 — wake steps: the rail as levy. The engine levies a
// child job per frontier wake step (once — the booking on disk is the
// guard), the step finishes on the child's wake.json (the receipt
// colors it), a failed child blocks downstream waves, and a rail
// spawner is never doorbelled — the durable wake IS the receipt.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../src/orchestrator.ts"
import { finishJob, readEvents, type JobRecord } from "../src/store.ts"
import { copyExampleNamed } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-wake-steps-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function fakeShep() {
  const wakes: { label: string; kind: string; detail: string }[] = []
  const spawned: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name, _kind, _briefPath, cwd) => {
      spawned.push(name)
      // the scripted worker: writes its result and its done line (the
      // engine's fs.watch/log-poller sees the log grow)
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "READY\n")
      writeFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
    paneAlive: () => true,
    retire: () => {},
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: (label, kind, detail) => wakes.push({ label, kind, detail }),
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, wakes, spawned }
}

type Levy = { unitId: string; folder: string }

// a fake child rail: records the levy, hands back a job dir the test
// can finish by writing wake.json (exactly what the real child's
// end-of-job wake does — finishJob/abortJob/orphanJob all book it)
function fakeLevy(dir: string) {
  const levies: Levy[] = []
  return {
    levies,
    port: (unitId: string, folder: string) => {
      levies.push({ unitId, folder })
      const jobDir = join(dir, "child-jobs", unitId)
      mkdirSync(jobDir, { recursive: true })
      const job = {
        id: `j-${unitId}`,
        sid: "s-child",
        stoodUpBy: "rail",
        workflow: "fan-out",
        task: unitId,
        dir: jobDir,
        state: "running",
        created: new Date().toISOString(),
        panes: [],
        spawner: { tool: "rail", session_id: "s-parent", since: new Date().toISOString() },
      } as unknown as JobRecord
      writeFileSync(join(jobDir, "job.json"), JSON.stringify(job))
      return { ok: true as const, jid: job.id, jobDir, warnings: [] }
    },
  }
}

function childWakes(dir: string, outcome: string, report?: string): void {
  writeFileSync(
    join(dir, "child-jobs", "sub", "wake.json"),
    JSON.stringify({ outcome, report: report ?? join(dir, "child-jobs", "sub", "report.json"), at: new Date().toISOString() }),
  )
}

test("a wake step levies once and finishes done on the child's wake (ADR 0007 stage 3)", async () => {
  const dir = await copyExampleNamed("fan-out-spurs/nested-wakes", "wake-once-")
  const shep = fakeShep()
  const levy = fakeLevy(dir)
  const engine = runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild: levy.port,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  // exactly one levy for the wake step — never a second while it waits
  assert.equal(levy.levies.length, 1)
  assert.equal(levy.levies[0].unitId, "sub")
  assert.ok(levy.levies[0].folder.endsWith(join("fan-out-spurs", "nested-wakes", "child")) || levy.levies[0].folder.endsWith("child"))
  // the booking is durable on the task dir
  assert.ok(existsSync(join(dir, "wakes", "sub.json")))
  childWakes(dir, "done")
  const report = await Promise.race([
    engine,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("wake never finished the step")), 4000)),
  ])
  assert.equal(report.status, "done")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /child j-sub done/)
  assert.equal(levy.levies.length, 1, "the booking guards against a second levy")
})

test("a failed child receipt fails the step and blocks downstream waves honestly", async () => {
  const dir = await copyExampleNamed("fan-out-spurs/nested-wakes", "wake-fail-")
  const wf = readFileSync(join(dir, "workflow.toml"), "utf8") +
    '\n[[step]]\nid = "audit"\nfinished_by = "check"\ncheck = "true"\nwave = "w3"\n'
  writeFileSync(join(dir, "workflow.toml"), wf)
  const shep = fakeShep()
  const levy = fakeLevy(dir)
  const engine = runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild: levy.port,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  childWakes(dir, "failed")
  const report = await Promise.race([
    engine,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("failed child never landed")), 4000)),
  ])
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /child j-sub failed/)
  // audit is unreachable — never asked, never counted against finishing
  assert.equal(byUnit.audit, undefined)
  assert.ok(shep.wakes.some((w) => w.label === "sub" && /child job j-sub failed/.test(w.detail)))
})

test("a refused levy is an honest failed row, not a retry loop", async () => {
  const dir = await copyExampleNamed("fan-out-spurs/nested-wakes", "wake-refused-")
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild: () => ({ ok: false, why: "no workflow.toml in /nowhere" }),
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /levy failed: no workflow\.toml in \/nowhere/)
})

test("a rail spawner is never doorbelled — the durable wake is the receipt", () => {
  const jobDir = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-rail", "jobs", "j-raillevy")
  mkdirSync(jobDir, { recursive: true })
  const job = {
    id: "j-raillevy",
    sid: "s-rail",
    stoodUpBy: "rail",
    workflow: "fan-out",
    task: "child program",
    dir: jobDir,
    state: "running",
    created: new Date().toISOString(),
    panes: [],
    spawner: { tool: "rail", session_id: "s-parent", since: new Date().toISOString() },
  } as unknown as JobRecord
  const woken = finishJob(job, {
    panesRemaining: 0,
    panesTotal: 0,
    unitsDone: 0,
    unitsFailed: 0,
    status: "done",
    report: join(jobDir, "report.json"),
  })
  // delivery stays queued: no pane prompt, no doorbell — the parent
  // rail polls wake.json (delivery "queued" books exactly that)
  assert.equal(woken.woke?.delivery, "queued")
  const wake = JSON.parse(readFileSync(join(jobDir, "wake.json"), "utf8"))
  assert.equal(wake.to.tool, "rail")
  assert.equal(wake.to.session_id, "s-parent")
  const events = readEvents("s-rail") ?? []
  assert.ok(events.some((e) => e.kind === "job.woke" && e.delivery === "queued"))
})
