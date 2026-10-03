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
