import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { copyExample } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-run-"))

const { prepareRun } = await import("../src/doors/run.ts")
const { listJobs } = await import("../src/adapters/store.ts")

const bin = join(import.meta.dirname, "..", "bin", "whitehartlane")
const stub = join(process.env.AGENTIC_OS_HOME, "engine-stub.mjs")
writeFileSync(stub, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.argv[2], 'engine-started'), 'ok\\n')\n")

function runCli(folder: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", bin, "run", folder, "--unattended"], {
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

test("run refuses a stage-less fan-out program — one authoring story (ADR 0014)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-nostages-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    '[workflow]\nname = "bare"\nworker_kind = "opencode"\n',
  )
  const refused = prepareRun(dir)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /no \[\[stage\]\] entries/)
  assert.equal(listJobs().filter((job) => job.task === "bare").length, 0)
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
  assert.match(hooked, /grade = "bash \//)
  const second = runCli(dir)
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /already running/)
})

test("a second Job does not see the first Job's progress", async () => {
  const { prepareRun } = await import("../src/doors/run.ts")
  const { abortJob } = await import("../src/adapters/store.ts")
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

test("the spur step file no longer admits — the door names the stage fix (ADR 0014 slice 2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-spur-"))
  const program =
    'export const spur = {\n  name: "tiny-lab",\n  steps: [\n    { id: "professor", does: "actor" },\n    { id: "students", does: "wave", after: ["professor"] },\n  ],\n}\n'
  writeFileSync(join(dir, "spur.mjs"), program)
  // naming the retired file directly
  const named = prepareRun(join(dir, "spur.mjs"))
  assert.equal(named.ok, false)
  if (!named.ok) assert.match(named.why, /spur step file is retired/)
  // the folder holding it
  const held = prepareRun(dir)
  assert.equal(held.ok, false)
  if (!held.ok) assert.match(held.why, /spur step file is retired/)
  // the legacy dag.mjs spelling: the same refusal, never a guess
  writeFileSync(join(dir, "dag.mjs"), program)
  rmSync(join(dir, "spur.mjs"))
  const legacy = prepareRun(dir)
  assert.equal(legacy.ok, false)
  if (!legacy.ok) assert.match(legacy.why, /spur step file is retired/)
  assert.equal(listJobs().filter((job) => job.task === "tiny-lab").length, 0)
})

test("run books a kind=lab program and stages its detectors as absolute paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-labtoml-"))
  mkdirSync(join(dir, "hooks"), { recursive: true })
  writeFileSync(join(dir, "workflow.toml"), 'kind = "lab"\n\n[workflow]\nname = "lab"\nworker_kind = "opencode"\n\n[detectors]\nsignal = "node hooks/signal.mjs"\n')
  writeFileSync(join(dir, "hooks", "signal.mjs"), "process.exit(0)\n")
  writeFileSync(join(dir, "actor.md"), "Tend the wave.\n")
  writeFileSync(join(dir, "roots.txt"), "/abs/target\n")
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true, booked.ok ? "" : booked.why)
  if (!booked.ok) return
  assert.equal(booked.kind, "lab")
  assert.match(readFileSync(join(booked.job.dir, "workflow.toml"), "utf8"), /signal = "node \//)
  assert.equal(readFileSync(join(booked.job.dir, "roots.txt"), "utf8"), "/abs/target\n")
  const { abortJob } = await import("../src/adapters/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})
