// Issue #295 — worker-pane plumbing dirties the project's committed
// opencode.json during runs. The writers (store.ts: permissions
// pre-seed, model pin, model settings, durable dialog grants) are
// GUARDED now: inside a git work tree their target is snapshotted
// pristine under the harness home, and the terminal transitions
// (finish/abort/fail/pause) plus the run door's boot repair restore
// it. These arms re-run the exact repro from the issue (j-dd28ac:
// 23 allow-lines survived retire) at every door.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-guard-"))

const {
  abortJob,
  addWorkerRoot,
  attachPane,
  createJob,
  finishJob,
  homeRoot,
  listJobs,
  pauseJob,
  readEvents,
  restoreGuardedConfigs,
  findOrOpenSession,
  writeOpencodeModel,
  writeOpencodeModelSettings,
  writeWorkerPermissions,
} = await import("../src/adapters/store.ts")

const PRISTINE = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "zhipuai-coding-plan/glm-5.3"
}
`

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout
}

function gitRepo(withConfig: boolean): string {
  const repo = mkdtempSync(join(tmpdir(), "agentic-os-wt-"))
  if (withConfig) writeFileSync(join(repo, "opencode.json"), PRISTINE)
  else writeFileSync(join(repo, "README.md"), "# repo with no committed opencode.json\n")
  git(repo, "init", "-q")
  git(repo, "config", "user.name", "yyx462-agent")
  git(repo, "config", "user.email", "52618739+yyx462@users.noreply.github.com")
  git(repo, "add", "-A")
  git(repo, "commit", "-qm", "seed")
  return repo
}

function status(repo: string): string {
  return spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).stdout.trim()
}

// every guard snapshot currently pending (path field of each record)
function pendingGuards(): string[] {
  const root = join(homeRoot(), "config-guards")
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => (JSON.parse(readFileSync(join(root, f), "utf8")) as { path: string }).path)
}

test("issue #295 repro: a boot write dirties the committed opencode.json; restore returns the pristine bytes", () => {
  const repo = gitRepo(true)
  // the rail's spawn pre-seed (rail.ts writePermissions(cwd)) plus the
  // dialog-escalation grant (rail.ts addWorkerRoot(cwd, ...)) — the two
  // doors the production receipt walked
  writeWorkerPermissions(repo, ["/tmp/a-job-root"])
  addWorkerRoot(repo, "/tmp/an-escalated-root")
  assert.match(status(repo), /M opencode\.json/, "the run dirties the committed config (mid-run isolation must reach the worker)")
  assert.ok(pendingGuards().includes(join(repo, "opencode.json")), "the guard snapshotted the pristine bytes")
  // boot repair / retire: no job claims this path
  const out = restoreGuardedConfigs()
  assert.ok(out.restored.includes(join(repo, "opencode.json")))
  assert.equal(status(repo), "", "the tree is clean at rest — the gate no longer trips")
  assert.equal(readFileSync(join(repo, "opencode.json"), "utf8"), PRISTINE, "byte-identical to the committed content")
  assert.equal(pendingGuards().length, 0, "the snapshot is consumed")
})

test("a running job claims its guard; finishJob releases it and the trace books the restore", () => {
  const repo = gitRepo(true)
  writeWorkerPermissions(repo)
  assert.match(status(repo), /M opencode\.json/)
  const { session } = findOrOpenSession({ cwd: repo })
  const job = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: join(homeRoot(), "jobs", jobDirName()) })
  attachPane(job, { label: "w-demo-abc", parent: "orchestrator", transcript: { tool: "opencode", cwd: repo, since: new Date().toISOString() } })
  assert.equal(listJobs().some((j) => j.state === "running"), true)
  // a live run owns the guard — restore stands down
  let out = restoreGuardedConfigs()
  assert.equal(out.restored.length, 0, "the running job's pane cwd claims the guard")
  assert.match(status(repo), /M opencode\.json/)
  // the terminal transition releases it
  finishJob(job, { panesRemaining: 0, panesTotal: 1, unitsDone: 1, unitsFailed: 0, status: "ok" })
  assert.equal(status(repo), "", "retire restored the pristine bytes")
  assert.ok(readEvents(session.id).some((e) => e.kind === "config.restored" && e.path === join(repo, "opencode.json")), "the restore lands on the trace")
})

test("divergent bytes are refused, never clobbered; the snapshot stays visible", () => {
  const repo = gitRepo(true)
  writeWorkerPermissions(repo)
  // a human edits the worktree's config while the guard is pending
  writeFileSync(join(repo, "opencode.json"), `{ "human": true }\n`)
  const out = restoreGuardedConfigs()
  assert.ok(out.refused.some((r) => r.path === join(repo, "opencode.json")))
  assert.equal(readFileSync(join(repo, "opencode.json"), "utf8"), `{ "human": true }\n`, "human bytes survive")
  assert.ok(pendingGuards().includes(join(repo, "opencode.json")), "the refused snapshot stays for the human to resolve")
})

test("a NEW opencode.json inside a repo is removed on restore (the model-pin doors, guard idempotent)", () => {
  const repo = gitRepo(false)
  writeOpencodeModel(repo, "zhipuai-coding-plan/glm-5.3")
  writeOpencodeModelSettings(repo, "zhipuai-coding-plan/glm-5.3", { temperature: 0.2 })
  assert.match(status(repo), /\?\? opencode\.json/, "an untracked new file dirties the tree just the same")
  assert.equal(pendingGuards().filter((p) => p === join(repo, "opencode.json")).length, 1, "two writer doors, ONE snapshot")
  const out = restoreGuardedConfigs()
  assert.ok(out.restored.includes(join(repo, "opencode.json")))
  assert.equal(existsSync(join(repo, "opencode.json")), false, "the run's file is gone")
  assert.equal(status(repo), "")
})

test("no git, no guard — the harness sandbox's run-local config is unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-nogit-"))
  writeWorkerPermissions(dir)
  assert.ok(existsSync(join(dir, "opencode.json")), "the per-run config still lands")
  assert.equal(pendingGuards().includes(join(dir, "opencode.json")), false, "nothing outside a work tree is ever snapshotted")
})

test("abort and pause release too (every terminal door)", () => {
  const repo = gitRepo(true)
  writeWorkerPermissions(repo)
  const { session } = findOrOpenSession({ cwd: repo })
  const jobA = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "a", dir: join(homeRoot(), "jobs", jobDirName()) })
  attachPane(jobA, { label: "w-abort-abc", parent: "orchestrator", transcript: { tool: "opencode", cwd: repo, since: new Date().toISOString() } })
  abortJob(jobA, "signal SIGTERM", 1)
  assert.equal(status(repo), "", "abort restored the pristine bytes")

  writeWorkerPermissions(repo) // a second run in the same worktree
  assert.match(status(repo), /M opencode\.json/)
  const jobP = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "p", dir: join(homeRoot(), "jobs", jobDirName()) })
  attachPane(jobP, { label: "w-pause-abc", parent: "orchestrator", transcript: { tool: "opencode", cwd: repo, since: new Date().toISOString() } })
  pauseJob(jobP, "drained", 0)
  assert.equal(status(repo), "", "pause parks the worktree clean; a continue re-seeds through the same guarded doors")
})

// unique dir names per job (no collision assertions needed beyond uniqueness)
function jobDirName(): string {
  return `j-${Math.random().toString(36).slice(2, 8)}`
}

test("cleanup: the temp home is disposable", () => {
  rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
})
