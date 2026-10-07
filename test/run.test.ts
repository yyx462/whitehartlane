import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { copyExample } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-run-"))

const { prepareRun } = await import("../src/run.ts")
const { listJobs } = await import("../src/store.ts")

const bin = join(import.meta.dirname, "..", "bin", "agentic-os")
const stub = join(process.env.AGENTIC_OS_HOME, "engine-stub.mjs")
writeFileSync(stub, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.argv[2], 'engine-started'), 'ok\\n')\n")

function runCli(folder: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", bin, "run", folder], {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME,
        AGENTIC_OS_ORCHESTRATOR: stub,
      },
    })
    return { status: 0, stdout, stderr: "" }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
  }
}

test("run refuses a folder with no workflow.toml and books nothing", async () => {
  const empty = mkdtempSync(join(tmpdir(), "agentic-os-run-empty-"))
  const refused = prepareRun(empty)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /no workflow.toml/)
  const cli = runCli(empty)
  assert.notEqual(cli.status, 0)
  assert.match(cli.stderr, /no workflow.toml/)
  assert.equal(existsSync(join(empty, "engine-started")), false)
  assert.equal(listJobs().length, 0)
})

test("run books a Job from the three-lookups manifest and rejects a second while it runs", async () => {
  const dir = await copyExample("agentic-os-run-")
  const first = runCli(dir)
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /^job: j-/m)
  assert.match(first.stdout, /log: .*\/jobs\/j-.*\/run\/orchestrator\.log/)
  assert.match(first.stdout, /trace: .*events\.jsonl/)
  const job = listJobs().find((row) => row.task.includes("three-lookups") || row.dir.includes("/run"))
  assert.ok(job)
  assert.notEqual(job.dir, dir)
  const started = join(job.dir, "engine-started")
  for (let i = 0; i < 50 && !existsSync(started); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(existsSync(started), true)
  assert.equal(existsSync(join(dir, "engine-started")), false)
  assert.equal(existsSync(join(dir, "units.jsonl")), false)
  assert.equal(job.state, "running")
  assert.equal(job.workflow, "fan-out")
  const hooked = readFileSync(join(job.dir, "workflow.toml"), "utf8")
  assert.match(hooked, /units = "bash \//)
  const second = runCli(dir)
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /already running/)
})

test("a second Job does not see the first Job's progress", async () => {
  const { prepareRun } = await import("../src/run.ts")
  const { abortJob } = await import("../src/store.ts")
  const dir = await copyExample("agentic-os-run-fresh-")
  const first = prepareRun(dir)
  assert.equal(first.ok, true)
  if (!first.ok) return
  writeFileSync(join(first.job.dir, "state.json"), JSON.stringify({ done: [], failed: ["france"] }))
  writeFileSync(join(first.job.dir, "units.jsonl"), "{\"id\":\"france\",\"brief\":\"x\"}\n")
  abortJob(first.job, "test", 0, "cli")
  const second = prepareRun(dir)
  assert.equal(second.ok, true)
  if (!second.ok) return
  assert.notEqual(second.job.dir, first.job.dir)
  assert.equal(existsSync(join(dir, "state.json")), false)
  assert.equal(existsSync(join(dir, "units.jsonl")), false)
  assert.equal(existsSync(join(second.job.dir, "state.json")), false)
  assert.equal(existsSync(join(second.job.dir, "units.jsonl")), false)
})

test("run books a lab Job from one dag file and stages it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-dag-"))
  writeFileSync(
    join(dir, "dag.mjs"),
    'export const dag = {\n  name: "tiny-lab",\n  steps: [\n    { id: "professor", does: "actor" },\n    { id: "students", does: "wave", after: ["professor"] },\n    { id: "grade", does: "grade", after: ["students"] },\n    { id: "report", does: "report", after: ["grade"] },\n  ],\n}\n',
  )
  const booked = prepareRun(join(dir, "dag.mjs"))
  assert.equal(booked.ok, true)
  if (!booked.ok) return
  assert.equal(booked.kind, "lab")
  assert.equal(booked.job.workflow, "lab")
  assert.equal(booked.job.task, "tiny-lab")
  assert.equal(existsSync(join(booked.job.dir, "dag.mjs")), true)
  const staged = readFileSync(join(booked.job.dir, "workflow.toml"), "utf8")
  assert.match(staged, /written by agentic-os/)
  assert.match(staged, /name = "tiny-lab"/)
  assert.equal(existsSync(join(dir, "workflow.toml")), false)
  const { abortJob } = await import("../src/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})

test("run refuses a dag file that schedules or calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-dag-bad-"))
  writeFileSync(join(dir, "dag.mjs"), 'export const dag = { name: "x", steps: [{ id: "a", does: "actor", after: go() }] }\n')
  const refused = prepareRun(join(dir, "dag.mjs"))
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /does not call/)
})

test("run stages a program's roots.txt beside the dag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-roots-"))
  writeFileSync(
    join(dir, "dag.mjs"),
    'export const dag = { name: "rooted", steps: [{ id: "a", does: "actor" }, { id: "b", does: "wave", after: ["a"] }] }\n',
  )
  writeFileSync(join(dir, "roots.txt"), "/abs/target\n/abs/prototypes\n")
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true)
  if (!booked.ok) return
  assert.equal(readFileSync(join(booked.job.dir, "roots.txt"), "utf8"), "/abs/target\n/abs/prototypes\n")
  const { abortJob } = await import("../src/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})

test("run refuses a gate step with no [gates] detector and books nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-gate-"))
  writeFileSync(
    join(dir, "dag.mjs"),
    'export const dag = {\n  name: "gated",\n  steps: [\n    { id: "professor", does: "actor" },\n    { id: "students", does: "wave", after: ["professor"] },\n    { id: "await-review", does: "gate", after: ["students"] },\n    { id: "report", does: "report", after: ["await-review"] },\n  ],\n}\n',
  )
  writeFileSync(
    join(dir, "workflow.toml"),
    '[workflow]\nname = "gated"\nworker_kind = "opencode"\n\n[hooks]\nunits = "true"\ngrade = "true"\ncounts = "true"\n',
  )
  const refused = prepareRun(dir)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /gate step await-review needs a \[gates\]/)
  assert.equal(listJobs().filter((job) => job.task === "gated").length, 0)

  writeFileSync(
    join(dir, "workflow.toml"),
    '[workflow]\nname = "gated"\nworker_kind = "opencode"\n\n[hooks]\nunits = "true"\ngrade = "true"\ncounts = "true"\n\n[gates]\nawait-review = "true"\n',
  )
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true)
  if (booked.ok) {
    const staged = readFileSync(join(booked.job.dir, "workflow.toml"), "utf8")
    assert.match(staged, /\[gates\]/)
    const { abortJob } = await import("../src/store.ts")
    abortJob(booked.job, "test", 0, "cli")
  }
})

test("run books git-wave and stages its detectors as absolute paths", async () => {
  const dir = join(import.meta.dirname, "..", "examples", "git-wave")
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true)
  if (!booked.ok) return
  assert.equal(booked.kind, "lab")
  const staged = readFileSync(join(booked.job.dir, "workflow.toml"), "utf8")
  assert.match(staged, /signal = "node \//)
  assert.match(staged, /await-review = "node \//)
  const { abortJob } = await import("../src/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})
