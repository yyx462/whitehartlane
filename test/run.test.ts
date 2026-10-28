import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { copyExample } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-run-"))

const { prepareRun } = await import("../src/doors/run.ts")
const { listJobs, saveJob } = await import("../src/adapters/store.ts")

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
  // a LIVE run carries a live orchestrator pid (the runner books it via
  // the pid event) — the fiction must match production, or the booking
  // probe reads this run as abandoned and orphans it (r15 momentum-8)
  job.pid = process.pid
  saveJob(job)
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
  if (!first.ok || !("job" in first)) return
  writeFileSync(join(first.job.dir, "state.json"), JSON.stringify({ done: [], failed: ["france"] }))
  writeFileSync(join(first.job.dir, "units.jsonl"), "{\"id\":\"france\",\"brief\":\"x\"}\n")
  abortJob(first.job, "test", 0, "cli")
  const second = prepareRun(dir)
  assert.equal(second.ok, true)
  if (!second.ok || !("job" in second)) return
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
  writeFileSync(join(dir, "contract.toml"), "[[contract.deliverables]]\nname = \"actor-log\"\npath = \"units/*/result.md\"\nkind = \"md\"\n")
  writeFileSync(join(dir, "hooks", "signal.mjs"), "process.exit(0)\n")
  writeFileSync(join(dir, "actor.md"), "Tend the wave.\n")
  writeFileSync(join(dir, "roots.txt"), "/abs/target\n")
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true, booked.ok ? "" : booked.why)
  if (!booked.ok || !("job" in booked)) return
  assert.equal(booked.kind, "lab")
  assert.match(readFileSync(join(booked.job.dir, "workflow.toml"), "utf8"), /signal = "node \//)
  assert.equal(readFileSync(join(booked.job.dir, "roots.txt"), "utf8"), "/abs/target\n")
  const { abortJob } = await import("../src/adapters/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})

// #205 — guarantee a deliverable on every commission: the OLD spur
// shape (a valid program with NO contract.toml) is refused AT THE
// SCREEN, and no job is formed. The declaration is contract.toml's
// [[contract.deliverables]] — the same one source the program's audit
// renders its checks from.
test("run refuses a deliverable-less program at the screen — no job is formed (#205)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-nodl-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    'kind = "coworker"\n[workflow]\nname = "old-spur"\nworker_kind = "opencode"\n[members.alpha]\ninitiates = true\n[members.beta]\n',
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "alpha")
  writeFileSync(join(dir, "members", "beta.md"), "beta")
  const before = listJobs().length
  const refused = prepareRun(dir)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /no deliverable forced in contract\.toml/)
  assert.equal(listJobs().filter((job) => job.task === "old-spur").length, 0, "no job is formed")
  assert.equal(listJobs().length, before, "the screen books nothing")
  // the fix is one file: declaring deliverables un-refuses it — and
  // the check proves it WITHOUT minting (#200 slice 7: the phantom-row
  // incident was exactly this assert booking a job)
  writeFileSync(
    join(dir, "contract.toml"),
    "[[contract.deliverables]]\nname = \"exchange-record\"\npath = \"relay.json\"\nkind = \"json\"\n",
  )
  const ok = prepareRun(dir, { check: true })
  assert.equal(ok.ok, true, "a declared deliverable passes the screen")
  assert.equal(listJobs().length, before, "the check mints nothing — no phantom rows (#68)")
})

// #196 / ADR 0016 slice 3: the staged program is SELF-CONTAINED —
// hooks/ travels into the run dir and every hook command (verdict
// included) resolves there. The interview taught this live: a relative
// verdict.sh doomed the run and the members hallucinated repairs
// (j-aaa5e4: "verdict hook failed twice: No such file or directory").
test("the staged program carries its hooks and resolves the verdict in the run dir (#196)", async () => {
  const dir = await mkdtempSync(join(tmpdir(), "agentic-os-hooks-"))
  cpSync(join(import.meta.dirname, "e2e", "whl-interview"), dir, { recursive: true })
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true)
  if (!booked.ok || !("job" in booked)) return
  const staged = readFileSync(join(booked.job.dir, "workflow.toml"), "utf8")
  const verdict = staged.match(/^verdict = "([^"]+)"/m)?.[1] ?? ""
  assert.notEqual(verdict, "", "the fixture declares a verdict hook")
  assert.ok(verdict.startsWith("bash "), `verdict stays a bash command: ${verdict}`)
  const verdictPath = verdict.replace(/^bash /, "").split(" ")[0]
  assert.ok(verdictPath.startsWith(booked.job.dir), `verdict resolves IN the run dir: ${verdictPath}`)
  assert.ok(existsSync(verdictPath), "the resolved verdict script exists (hooks/ traveled)")
  const { abortJob } = await import("../src/adapters/store.ts")
  abortJob(booked.job, "test", 0, "cli")
})

// #200 slice 7 / #68: prepareRun-as-check used to BOOK. The check verb
// runs every program screen and mints zero rows; the booking path is
// unchanged for whl run and the levy.
test("the admission check mints nothing — no phantom running job blocks the next levy (#68)", async () => {
  const dir = await copyExample("agentic-os-check-")
  const before = listJobs().length
  const checked = prepareRun(dir, { check: true })
  assert.equal(checked.ok, true)
  assert.equal(listJobs().length, before, "check minted no job row")
  if (checked.ok) {
    assert.ok(!("job" in checked), "the check result carries no job")
    assert.equal(checked.kind, "fan-out")
  }
  // the check consumed nothing: the same folder still books for real
  const booked = prepareRun(dir)
  assert.equal(booked.ok, true)
  assert.equal(listJobs().length, before + 1, "the booking path still books")
  if (booked.ok && "job" in booked) {
    const { abortJob } = await import("../src/adapters/store.ts")
    abortJob(booked.job, "test", 0, "cli")
  }
})
