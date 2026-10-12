import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { admitFork } from "../src/policy.ts"
import type { RunnerResult } from "../src/runners.ts"
import type { JobRecord } from "../src/store.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-fork-"))

const { attachPane, createJob, findOrOpenSession, projectJob, readEvents } = await import("../src/store.ts")
const { forkLevy, forkReaperCmd } = await import("../src/fork.ts")

test("a fork is booked: pane.born carries the seed beside the parent", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/lend" })
  const job = createJob({ sid: session.id, stoodUpBy: "standalone", workflow: "coworker", task: "feature-lend" })
  const since = new Date().toISOString()
  const seed = { tool: "pi", session_id: "uuid-old", since }
  attachPane(job, { label: "lender", parent: "orchestrator", seed })
  attachPane(job, { label: "borrower", parent: "orchestrator" })

  const born = readEvents(session.id).find((e) => e.kind === "pane.born" && e.label === "lender")!
  assert.equal((born.seed as { session_id: string }).session_id, "uuid-old")
  assert.equal(born.parent, "orchestrator")

  // the projection restores the seed — the record is a faithful view
  const projected = projectJob(session.id, job.id)
  assert.equal(projected?.panes.find((p) => p.label === "lender")?.seed?.session_id, "uuid-old")
  assert.equal(projected?.panes.find((p) => p.label === "borrower")?.seed, undefined)
})

test("fork admission: the seed must resolve — known tool, readable session", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-seed-"))
  const file = join(dir, "old-session.jsonl")
  writeFileSync(file, "{}\n")
  const fileExists = (p: string) => p === file

  assert.equal(admitFork({ seed: { tool: "pi", session_id: "u1", session_file: file }, fileExists }).admit, true)
  assert.equal(admitFork({ seed: { tool: "opencode", session_id: "u1", session_file: file }, fileExists }).admit, true)
  assert.match(admitFork({ seed: { tool: "dsh", session_id: "u1", session_file: file }, fileExists }).why ?? "", /unknown seed tool/)
  assert.match(admitFork({ seed: { tool: "pi", session_id: "u1" }, fileExists }).why ?? "", /no session_file/)
  assert.match(
    admitFork({ seed: { tool: "pi", session_id: "u1", session_file: join(dir, "gone.jsonl") }, fileExists }).why ?? "",
    /unreadable/,
  )
})

test("fork courier: the reaper command closes tab + pane once the agent idles", () => {
  const cmd = forkReaperCmd("fork-j-abc", "wF:p2", "wF:t4")
  assert.match(cmd, /agent wait fork-j-abc --until idle/)
  assert.match(cmd, /tab close wF:t4/)
  assert.match(cmd, /pane close wF:p2/)
})

test("fork courier: delivery arms the self-close reaper", () => {
  const dbDir = mkdtempSync(join(tmpdir(), "aos-courier-"))
  process.env.OPENCODE_DB = join(dbDir, "opencode.db")
  const db = new DatabaseSync(process.env.OPENCODE_DB)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.prepare("INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)").run("ses_x", "/tmp/courier", 1)
  db.close()
  const reaped: string[] = []
  const ok = (body: object) => ({ status: 0, stdout: JSON.stringify(body) })
  const herdrRun = (args: string[]): RunnerResult => {
    const a = args.join(" ")
    if (a.startsWith("tab create")) return ok({ result: { root_pane: { pane_id: "wF:root", tab_id: "wF:t7" }, tab: { tab_id: "wF:t7" } } })
    if (a.startsWith("pane split")) return ok({ result: { pane: { pane_id: "wF:sh" } } })
    return ok({ result: {} })
  }
  const job = {
    id: "j-courier", dir: "/tmp/courier", status: "retired", created: "", updated: "",
    spawner: { tool: "opencode", session_id: "ses_x", since: "n1" },
  } as unknown as JobRecord
  const out = forkLevy(job, { message: "spur done" }, { herdrRun, detachedSpawn: (cmd) => reaped.push(cmd) })
  assert.equal(out.ok, true)
  assert.equal(reaped.length, 1, "reaper armed on delivery")
  assert.match(reaped[0], /tab close wF:t7/)
})
