import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-store-"))

const {
  abortJob,
  appendEvent,
  attachPane,
  createJob,
  eventsPath,
  finishJob,
  homeRoot,
  jobRunDir,
  killPane,
  listJobs,
  listSessions,
  loadJob,
  findOrOpenSession,
  openSession,
  orphanJob,
  projectJob,
  readEvents,
  relaunchJob,
  shortId,
} = await import("../src/store.ts")

test("the home root honors AGENTIC_OS_HOME", () => {
  assert.equal(homeRoot(), process.env.AGENTIC_OS_HOME)
})

test("a host-bound session is found, not duplicated (duplicate rule 1)", () => {
  const host = { tool: "pi", session_id: "uuid-1", session_file: "~/.pi/agent/sessions/x.jsonl" }
  const first = findOrOpenSession({ cwd: "/tmp/repo", host })
  assert.equal(first.created, true)
  // the same conversation resumes: same OS session, no duplicate
  const again = findOrOpenSession({ cwd: "/tmp/repo", host })
  assert.equal(again.created, false)
  assert.equal(again.session.id, first.session.id)
  assert.equal(listSessions().length, 1)
  // a different host conversation is a different session
  const other = findOrOpenSession({ cwd: "/tmp/repo", host: { ...host, session_id: "uuid-2" } })
  assert.equal(other.created, true)
  assert.equal(listSessions().length, 2)
  // a different host tool with the same id is also distinct
  const dsh = findOrOpenSession({ cwd: "/tmp/repo", host: { tool: "dsh", session_id: "uuid-1" } })
  assert.equal(dsh.created, true)
  assert.notEqual(dsh.session.id, first.session.id)
})

test("a session without a host is an auto session (standalone runs)", () => {
  const session = openSession({ cwd: "/tmp/run" })
  assert.match(session.id, /^auto-/)
  assert.ok(existsSync(join(homeRoot(), "sessions", session.id, "session.json")))
})

test("shortIds do not collide", () => {
  const ids = new Set(Array.from({ length: 50 }, () => shortId("j")))
  assert.equal(ids.size, 50)
})

test("a Job's life is events; the record is a faithful projection", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/repo" })
  const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "look up capitals", dir: jobRunDir(session.id, "x") })
  assert.equal(job.state, "running")

  const since = new Date().toISOString()
  attachPane(job, { label: "w-europe-r1", pane: "p1", unit: "europe", transcript: { tool: "pi", cwd: "/run/units/europe", since } })
  attachPane(job, { label: "w-europe-r1", pane: "p1", unit: "europe", transcript: { tool: "pi", cwd: "/run/units/europe", since } }) // idempotent
  attachPane(job, { label: "w-asia-r1", pane: "p2", unit: "asia", transcript: { tool: "opencode", cwd: "/run/units/asia", since } })
  appendEvent(session.id, { actor: "orchestrator", kind: "unit.settled", jid: job.id, unit: "europe", pass: true, result: "Paris ✓" })
  killPane(job, "w-europe-r1")
  killPane(job, "w-asia-r1")
  finishJob(job, { panesRemaining: 0, panesTotal: 2, unitsDone: 2, unitsFailed: 0, status: "done" })

  // the record on disk
  const back = loadJob(session.id, job.id)
  assert.equal(back?.state, "retired")
  assert.equal(back?.receipt?.panesRemaining, 0)
  assert.equal(back?.panes.length, 2)
  assert.equal(back?.panes[0].transcript?.tool, "pi")
  assert.ok(existsSync(join(homeRoot(), "sessions", session.id, "jobs", job.id, "job.json")), "record survives retirement (zen 5)")

  // the projection from events matches the record
  const projected = projectJob(session.id, job.id)
  assert.equal(projected?.state, "retired")
  assert.equal(projected?.panes.length, 2)
  assert.equal(projected?.panes[0].label, "w-europe-r1")
  assert.equal(projected?.panes[0].transcript?.tool, "pi")
  assert.equal(projected?.receipt?.panesRemaining, 0)
  assert.deepEqual(
    projected?.panes.map((p) => p.died !== undefined),
    [true, true],
  )

  // the trace itself is ordered and append-only
  const kinds = readEvents(session.id).map((e) => e.kind)
  assert.deepEqual(
    kinds.filter((k) => k !== "route"),
    ["job.born", "pane.born", "pane.born", "unit.settled", "pane.died", "pane.died", "job.retired"],
  )
})

test("abortJob keeps the record with a reason, not a receipt", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/repo2" })
  const job = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: "/tmp/run2", pid: 424242 })
  abortJob(job, "signal SIGTERM", 2)
  const back = loadJob(session.id, job.id)
  assert.equal(back?.state, "aborted")
  assert.equal(back?.abort?.reason, "signal SIGTERM")
  assert.equal(back?.abort?.panesRemaining, 2)
  assert.equal(back?.receipt, undefined)
  assert.equal(projectJob(session.id, job.id)?.state, "aborted")
})

test("events file lives at events.jsonl and never splits per job", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/repo3" })
  appendEvent(session.id, { actor: "first_mate", kind: "route", decision: "direct", confidence: 0.9 })
  assert.ok(existsSync(eventsPath(session.id)))
  assert.equal(readEvents(session.id).length, 1)
})

test("listJobs spans sessions in creation order", async () => {
  const before = listJobs().length
  const s1 = findOrOpenSession({ cwd: "/tmp/a" }).session
  const s2 = findOrOpenSession({ cwd: "/tmp/b" }).session
  createJob({ sid: s1.id, stoodUpBy: "standalone", workflow: "fan-out", task: "a", dir: "/tmp/a" })
  await new Promise((r) => setTimeout(r, 3)) // distinct created timestamps
  createJob({ sid: s2.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "b", dir: "/tmp/b" })
  const dirs = listJobs().slice(before).map((job) => job.dir)
  assert.deepEqual(dirs, ["/tmp/a", "/tmp/b"])
})

test("materializeRunDir writes the per-run worker permission scope", async () => {
  const { materializeRunDir } = await import("../src/store.ts")
  const { realpathSync } = await import("node:fs")
  const exampleSrc = join(import.meta.dirname, "..", "examples", "three-lookups", "workflow.toml")
  const runDir = join(process.env.AGENTIC_OS_HOME!, "sessions", "perm-test", "jobs", "j-x", "run")
  materializeRunDir(runDir, "t", exampleSrc)
  const oc = JSON.parse(readFileSync(join(runDir, "opencode.json"), "utf8"))
  assert.equal(oc.permission.external_directory["*"], "ask")
  assert.equal(oc.model, undefined)
  assert.ok(`${realpathSync(runDir)}/**` in oc.permission.external_directory)
  // both spellings: given path (what briefs quote) and realpath (what
  // opencode canonicalizes to) — they differ on symlinked roots like /tmp
  const tmpForm = mkdtempSync("/tmp/agentic-os-perm-")
  try {
    materializeRunDir(join(tmpForm, "run"), "t", exampleSrc)
    assert.notEqual(realpathSync(join(tmpForm, "run")), join(tmpForm, "run"), "this platform splits /tmp (else the two-form test is vacuous)")
    const oc2 = JSON.parse(readFileSync(join(tmpForm, "run", "opencode.json"), "utf8"))
    assert.ok(`${tmpForm}/run/**` in oc2.permission.external_directory)
    assert.ok(`${realpathSync(join(tmpForm, "run"))}/**` in oc2.permission.external_directory)
  } finally {
    rmSync(tmpForm, { recursive: true, force: true })
  }
  assert.ok(existsSync(join(runDir, "hooks", "units.sh")), "hooks copied")
})

test("a model in workflow.toml lands in the project files, not the user pi dir", async () => {
  const { writePiSettings, writeWorkerPermissions } = await import("../src/store.ts")
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-model-"))
  writeFileSync(join(dir, "workflow.toml"), '[workflow]\nname = "t"\nworker_kind = "pi"\nmodel = "xai/grok-4.7"\n[hooks]\nunits = "u"\ngrade = "g"\ncounts = "c"\n')
  const skill = mkdtempSync(join(tmpdir(), "agentic-os-skill-"))
  writeWorkerPermissions(dir, [skill])
  const oc = JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8"))
  assert.equal(oc.model, "xai/grok-4.7")
  assert.equal(oc.permission.external_directory[`${skill}/**`], "allow")
  const unit = join(dir, "units", "france")
  mkdirSync(unit, { recursive: true })
  writePiSettings(unit, "xai/grok-4.7")
  const pi = JSON.parse(readFileSync(join(unit, ".pi", "settings.json"), "utf8"))
  assert.deepEqual(pi, { defaultProvider: "xai", defaultModel: "grok-4.7" })
  assert.equal(existsSync(join(dir, ".pi", "auth.json")), false)
})

test("a dead orchestrator parks the Job as orphaned; relaunch and decline are bookkept", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/orphan-lifecycle" })
  const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "t", dir: "/tmp/o" })
  assert.equal(job.state, "running")

  // graceful abort never orphans (the signal handler's path)
  const graceful = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "fan-out", task: "g", dir: "/tmp/g" })
  abortJob(graceful, "signal SIGTERM", 0, "orchestrator")
  assert.equal(orphanJob(graceful, "pid gone", 0).state, "aborted")

  // retired never orphans either
  orphanJob(job, `orchestrator pid 4194300 gone`, 2)
  assert.equal(loadJob(session.id, job.id)!.state, "orphaned")
  assert.ok(readEvents(session.id).some((e) => e.kind === "job.orphaned" && e.jid === job.id))

  const relaunched = relaunchJob(job, 99901)
  assert.equal(relaunched.state, "running")
  assert.equal(relaunched.relaunches, 1)
  assert.equal(relaunched.orphan, undefined)
  const relaunched2 = relaunchJob(relaunched, 99902)
  assert.equal(relaunched2.relaunches, 2)

  // the projection rebuilds the whole arc: born → orphaned → relaunched ×2
  const projected = projectJob(session.id, job.id)!
  assert.equal(projected.state, "running")
  assert.equal(projected.relaunches, 2)
  assert.equal(projected.orphan, undefined)
  assert.equal(projected.pid, 99902)

  // declining an orphaned job aborts with the user as actor
  orphanJob(relaunched2, "pid gone again", 1)
  abortJob(relaunched2, "declined by user", 1, "first_mate")
  const declined = projectJob(session.id, job.id)!
  assert.equal(declined.state, "aborted")
  assert.equal(declined.abort!.reason, "declined by user")
  assert.equal(declined.abort!.finished, declined.finished)
})

test("pane.born carries the JEV parent stamp", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/parent-stamp" })
  const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "t", dir: "/tmp/p" })
  attachPane(job, { label: "w-capitals-xyz", parent: "orchestrator", transcript: { tool: "pi", cwd: "/tmp/p", since: new Date().toISOString() } })
  const born = readEvents(session.id).find((e) => e.kind === "pane.born" && e.label === "w-capitals-xyz")!
  assert.equal(born.parent, "orchestrator")
  assert.equal(projectJob(session.id, job.id)!.panes[0]!.parent, "orchestrator")
})

test("cleanup: the temp home is disposable", () => {
  rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
})
