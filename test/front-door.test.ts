import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fanOutShepPlan, show, standUp } from "../src/front-door.ts"

const EXAMPLE = join(import.meta.dirname, "..", "examples", "three-lookups")

async function copyExample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentic-os-proj-"))
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

test("three independent lookups finish as a fan-out report", async () => {
  const report = await standUp({
    task: "look up the capitals of France, Japan, and Peru",
    taskDir: "/tmp/lookups",
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [
        { id: "france", brief: "capital of France" },
        { id: "japan", brief: "capital of Japan" },
        { id: "peru", brief: "capital of Peru" },
      ],
      grade: () => ({ pass: true, row: "found" }),
      counts: (rows) => ({ lookups: rows.length }),
      workerKind: "opencode",
    },
  })

  assert.equal(report.kind, "report")
  assert.equal(report.status, "done")
  assert.deepEqual(report.counts, { lookups: 3 })
  assert.deepEqual(
    report.table.map((row) => row.unit),
    ["france", "japan", "peru"],
  )
  assert.equal(report.where, "/tmp/lookups")
})

test("a coding task opens a direct chat and does not finish", async () => {
  const session = await standUp({
    task: "rename the helper",
    taskDir: "/tmp/direct",
    jev: async () => ({ workflow: "direct", confidence: 0.88 }),
    hooks: {
      units: () => [{ id: "rename", brief: "rename the helper" }],
      grade: () => ({ pass: true, row: "unused" }),
      counts: () => ({ lookups: 1 }),
      workerKind: "pi",
    },
  })

  assert.equal(session.kind, "session")
  assert.equal("status" in session, false)
})

test("low confidence asks the user and does not stand up a workflow", async () => {
  const asked = await standUp({
    task: "maybe these can run apart",
    taskDir: "/tmp/unsure",
    jev: async () => ({ workflow: "fan-out", confidence: 0.4 }),
    hooks: {
      units: () => [{ id: "a", brief: "a" }],
      grade: () => ({ pass: true, row: "found" }),
      counts: () => ({ lookups: 1 }),
      workerKind: "opencode",
    },
  })

  assert.equal(asked.kind, "ask")
})

test("direct retries a blocked worker three times and then says so", async () => {
  let starts = 0
  const session = await standUp({
    task: "rename the helper",
    taskDir: "/tmp/direct",
    jev: async () => ({ workflow: "direct", confidence: 0.88 }),
    hooks: {
      units: () => [{ id: "rename", brief: "rename the helper" }],
      grade: () => ({ pass: true, row: "unused" }),
      counts: () => ({ lookups: 1 }),
      workerKind: "pi",
    },
    startWorker: () => {
      starts += 1
    },
  })

  assert.equal(session.kind, "session")
  if (session.kind !== "session") return
  assert.equal(starts, 1)

  session.blocked()
  session.blocked()
  session.blocked()
  assert.equal(starts, 4)
  assert.deepEqual(session.chat, [])

  session.blocked()
  assert.equal(starts, 4)
  assert.deepEqual(session.chat, ["Stopped after 3 retries."])
})

test("a provider refusal stops new calls until a probe succeeds", async () => {
  const admitted: string[] = []
  let japanRefuses = true
  const run = await standUp({
    task: "look up the capitals of France, Japan, and Peru",
    taskDir: "/tmp/lookups",
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [
        { id: "france", brief: "capital of France" },
        { id: "japan", brief: "capital of Japan" },
        { id: "peru", brief: "capital of Peru" },
      ],
      grade: () => ({ pass: true, row: "found" }),
      counts: (rows) => ({ lookups: rows.length }),
      workerKind: "opencode",
    },
    provider: {
      admit: (unit) => {
        admitted.push(unit.id)
        if (unit.id === "japan" && japanRefuses) return "refused"
        return "ok"
      },
      probe: () => {
        japanRefuses = false
        return "ok" as const
      },
    },
  })

  assert.equal(run.kind, "waiting")
  if (run.kind !== "waiting") return
  assert.deepEqual(admitted, ["france", "japan"])

  await run.probe()
  assert.deepEqual(admitted, ["france", "japan", "japan", "peru"])
  assert.equal(run.report().status, "done")
  assert.deepEqual(run.report().counts, { lookups: 3 })
})

test("fan-out gives the orchestrator its own lane and caps workers at 3 per tab", async () => {
  const panes: { role: string; lane: string; tab: number }[] = []
  await standUp({
    task: "look up four capitals",
    taskDir: "/tmp/lookups",
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [
        { id: "france", brief: "France" },
        { id: "japan", brief: "Japan" },
        { id: "peru", brief: "Peru" },
        { id: "chile", brief: "Chile" },
      ],
      grade: () => ({ pass: true, row: "found" }),
      counts: (rows) => ({ lookups: rows.length }),
      workerKind: "opencode",
    },
    panes: {
      open: (pane) => panes.push(pane),
    },
  })

  assert.deepEqual(panes, [
    { role: "orchestrator", lane: "orchestrator", tab: 1 },
    { role: "worker", lane: "workers", tab: 1 },
    { role: "worker", lane: "workers", tab: 1 },
    { role: "worker", lane: "workers", tab: 1 },
    { role: "worker", lane: "workers", tab: 2 },
  ])
})

test("a failed grade is the unit result in the report", async () => {
  const report = await standUp({
    task: "look up three capitals",
    taskDir: "/tmp/lookups",
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [
        { id: "france", brief: "France" },
        { id: "japan", brief: "Japan" },
        { id: "peru", brief: "Peru" },
      ],
      grade: (unit) =>
        unit.id === "japan"
          ? { pass: false, row: "missing" }
          : { pass: true, row: "found" },
      counts: (rows) => ({
        lookups: rows.length,
        failed: rows.filter((row) => row.result === "missing").length,
      }),
      workerKind: "opencode",
    },
  })

  assert.equal(report.kind, "report")
  if (report.kind !== "report") return
  assert.equal(report.status, "failed")
  assert.deepEqual(report.counts, { lookups: 3, failed: 1 })
  assert.deepEqual(report.table[1], { unit: "japan", result: "missing" })
})

test("fan-out writes the report into the task directory", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "agentic-os-"))
  await standUp({
    task: "look up the capitals of France, Japan, and Peru",
    taskDir,
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [
        { id: "france", brief: "capital of France" },
        { id: "japan", brief: "capital of Japan" },
        { id: "peru", brief: "capital of Peru" },
      ],
      grade: () => ({ pass: true, row: "found" }),
      counts: (rows) => ({ lookups: rows.length }),
      workerKind: "opencode",
    },
  })

  const written = JSON.parse(await readFile(join(taskDir, "report.json"), "utf8"))
  assert.equal(written.status, "done")
  assert.deepEqual(written.counts, { lookups: 3 })
  assert.equal(written.where, taskDir)
})

test("the front door shows the report as status, counts, a table, and where to check", () => {
  const text = show({
    kind: "report",
    status: "done",
    counts: { lookups: 3 },
    table: [
      { unit: "france", result: "found" },
      { unit: "japan", result: "found" },
      { unit: "peru", result: "found" },
    ],
    where: "/tmp/lookups",
  })

  assert.equal(
    text,
    [
      "status: done",
      "lookups: 3",
      "",
      "unit    result",
      "france  found",
      "japan   found",
      "peru    found",
      "",
      "check: /tmp/lookups",
    ].join("\n"),
  )
})

test("fan-out calls shep for an orchestrator lane and one worker per unit", () => {
  assert.deepEqual(
    fanOutShepPlan({
      cwd: "/work",
      workerKind: "opencode",
      units: [
        { id: "france", brief: "France" },
        { id: "japan", brief: "Japan" },
        { id: "peru", brief: "Peru" },
        { id: "chile", brief: "Chile" },
      ],
    }),
    [
      ["shep", "spawn", "orchestrator", "--kind", "opencode", "--cwd", "/work", "--dir", "right", "--brief", "@/work/orchestrator.brief.md"],
      ["shep", "spawn", "w-france", "--kind", "opencode", "--cwd", "/work", "--brief", "@/work/france.brief.md"],
      ["shep", "spawn", "w-japan", "--kind", "opencode", "--cwd", "/work", "--brief", "@/work/japan.brief.md"],
      ["shep", "spawn", "w-peru", "--kind", "opencode", "--cwd", "/work", "--brief", "@/work/peru.brief.md"],
      ["shep", "spawn", "w-chile", "--kind", "opencode", "--cwd", "/work", "--brief", "@/work/chile.brief.md"],
    ],
  )
})

test("direct calls no shep", async () => {
  const calls: string[][] = []
  const session = await standUp({
    task: "rename the helper",
    taskDir: "/work",
    jev: async () => ({ workflow: "direct", confidence: 0.9 }),
    hooks: {
      units: () => [{ id: "rename", brief: "rename the helper" }],
      grade: () => ({ pass: true, row: "unused" }),
      counts: () => ({ lookups: 1 }),
      workerKind: "pi",
    },
    runShep: (argv) => {
      calls.push(argv)
    },
  })

  assert.equal(session.kind, "session")
  assert.deepEqual(calls, [])
})

test("the task directory defaults to the directory the agent was opened in", async () => {
  const opened = await mkdtemp(join(tmpdir(), "agentic-os-cwd-"))
  const report = await standUp({
    task: "look up one capital",
    cwd: () => opened,
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    hooks: {
      units: () => [{ id: "france", brief: "France" }],
      grade: () => ({ pass: true, row: "found" }),
      counts: (rows) => ({ lookups: rows.length }),
      workerKind: "opencode",
    },
  })

  assert.equal(report.kind, "report")
  if (report.kind !== "report") return
  assert.equal(report.where, opened)
})

test("project mode runs the example workflow from its manifest", async () => {
  const dir = await copyExample()
  for (const id of ["france", "japan", "peru"]) {
    mkdirSync(join(dir, "units", id), { recursive: true })
    writeFileSync(join(dir, "units", id, "result.md"), "capital\n")
  }

  const report = await standUp({
    task: "look up three capitals",
    taskDir: dir,
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
  })

  assert.equal(report.kind, "report")
  if (report.kind !== "report") return
  assert.equal(report.status, "done")
  assert.deepEqual(report.counts, { lookups: 3, failed: 0 })
  assert.deepEqual(
    report.table.map((row) => row.result),
    ["found", "found", "found"],
  )
  assert.equal(report.where, "units/")

  const snapshot = readFileSync(join(dir, "units.jsonl"), "utf8").trim().split("\n")
  assert.equal(snapshot.length, 3)
  assert.ok(snapshot[0].includes('"id":"france"'))
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))
  assert.deepEqual(state, { done: ["france", "japan", "peru"], failed: [] })
})

test("project mode settles a missing artifact as failed", async () => {
  const dir = await copyExample()
  for (const id of ["france", "peru"]) {
    mkdirSync(join(dir, "units", id), { recursive: true })
    writeFileSync(join(dir, "units", id, "result.md"), id === "france" ? "Paris\n" : "Lima\n")
  }

  const report = await standUp({
    task: "look up three capitals",
    taskDir: dir,
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
  })

  assert.equal(report.kind, "report")
  if (report.kind !== "report") return
  assert.equal(report.status, "failed")
  assert.deepEqual(report.counts, { lookups: 3, failed: 1 })
  const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))
  assert.deepEqual(state, { done: ["france", "peru"], failed: ["japan"] })
})

test("a worker port runs before grade and produces the artifacts", async () => {
  const dir = await copyExample()
  const ran: string[] = []

  const report = await standUp({
    task: "look up three capitals",
    taskDir: dir,
    jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    runWorker: async (unit) => {
      ran.push(unit.id)
      mkdirSync(join(dir, "units", unit.id), { recursive: true })
      writeFileSync(join(dir, "units", unit.id, "result.md"), "capital\n")
    },
  })

  assert.deepEqual(ran, ["france", "japan", "peru"])
  assert.equal(report.kind, "report")
  if (report.kind !== "report") return
  assert.equal(report.status, "done")
})

test("project mode without workflow.toml is a clean error", async () => {
  const empty = await mkdtemp(join(tmpdir(), "agentic-os-none-"))
  await assert.rejects(
    standUp({
      task: "look up three capitals",
      taskDir: empty,
      jev: async () => ({ workflow: "fan-out", confidence: 0.91 }),
    }),
    /no workflow\.toml/,
  )
})
