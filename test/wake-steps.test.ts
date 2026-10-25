// ADR 0007 stage 3 — the rail as levy, in the one authoring story
// (ADR 0014): a delegating lab stage compiles to a wake step whose
// child the orchestrator mints under stages/<id>/ — levied once (the
// booking on disk is the guard), finished by the child's wake.json
// (the receipt colors it), a failed child blocks downstream waves.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../src/engines/orchestrator.ts"
import { finishJob, readEvents, type JobRecord } from "../src/adapters/store.ts"

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

// a solo work stage, then a delegating lab stage (wake step)
function nestedStagesDir(prefix: string, extra = ""): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "nested-stages"
worker_kind = "opencode"

[[stage]]
id = "g0"
topology = "solo"
brief = "warm up"

[[stage]]
id = "sub"
topology = "lab"
brief = "the experiment"
${extra}`,
  )
  return dir
}

test("a lab station hosts once and finishes done on the engine's report (ADR 0016 slice 2)", async () => {
  const dir = nestedStagesDir("wake-once-")
  const shep = fakeShep()
  const hosted: string[] = []
  let release: (() => void) | null = null
  const gate = new Promise<void>((resolve) => { release = resolve })
  const engine = runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    hostStation: async (stage, stationDir) => {
      hosted.push(stage.id)
      mkdirSync(stationDir, { recursive: true })
      writeFileSync(join(stationDir, "found.md"), "signal\n")
      await gate // the exchange takes time — the chain waits on it
      return { status: "done", table: [] }
    },
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  await new Promise((resolve) => setTimeout(resolve, 250))
  // hosted exactly once, at the station — never a second while it runs
  assert.deepEqual(hosted, ["sub"])
  assert.ok(existsSync(join(dir, "stations", "sub", "protocol.json")), "the station books itself durably")
  assert.equal(existsSync(join(dir, "stages")), false, "no mint, ever")
  release!()
  const report = await Promise.race([
    engine,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the station never settled")), 4000)),
  ])
  assert.equal(report.status, "done")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /^station sub done/)
  assert.deepEqual(hosted, ["sub"], "the booking guards against a second hosting")
})

test("a failed child receipt fails the step and blocks downstream waves honestly", async () => {
  // a failed child receipt blocks the downstream unit stage honestly
  const dir = nestedStagesDir("wake-fail-", `
[[stage]]
id = "audit"
topology = "fan-out"
units = [{ id = "auditor", brief = "audit the experiment" }]
`)
  const shep = fakeShep()
  const engine = runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    hostStation: async (stage, stationDir) => {
      mkdirSync(stationDir, { recursive: true })
      return { status: "failed", table: [] }
    },
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  const report = await Promise.race([
    engine,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("failed station never landed")), 4000)),
  ])
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /^station sub failed/)
  // audit is unreachable — never spawned, never counted against finishing
  assert.ok(!shep.spawned.includes("w-auditor"))
  assert.match(byUnit.auditor, /wave blocked by failed sub/)
  assert.ok(shep.wakes.some((w) => w.label === "sub" && /station exchange failed/.test(w.detail)))
})

test("a station host that throws is an honest failed row, not a retry loop", async () => {
  const dir = nestedStagesDir("wake-refused-")
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    hostStation: async () => {
      throw new Error("no workflow.toml in /nowhere")
    },
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.sub, /no workflow\.toml in \/nowhere/)
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
