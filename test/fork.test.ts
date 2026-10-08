import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { admitFork } from "../src/policy.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-fork-"))

const { attachPane, createJob, findOrOpenSession, projectJob, readEvents } = await import("../src/store.ts")

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
