// ADR 0006 §3 — the fork verb's pure half: the seed points back to
// the spawner checkpoint only; the first prompt carries the wake; the
// seed must resolve (pi header id, opencode db row) before admission.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { forkPrompt, forkSeedOf } from "../src/adapters/fork.ts"
import { createJob } from "../src/adapters/store.ts"
import { seedSessionFile } from "../src/adapters/transcripts.ts"
import { admitFork } from "../src/jev/policy.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-forkcli-"))
const piRoot = mkdtempSync(join(tmpdir(), "aos-forkpi-"))
const dbDir = mkdtempSync(join(tmpdir(), "aos-forkdb-"))
process.env.PI_SESSIONS_ROOT = piRoot
process.env.OPENCODE_DB = join(dbDir, "opencode.db")

test.after(() => {
  rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
  rmSync(piRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

const SINCE = "2026-10-09T00:00:00.000Z"

test("forkSeedOf points back to the spawner checkpoint, or nothing", () => {
  const spawner = { tool: "opencode", session_id: "ses_01abc", since: SINCE }
  const job = createJob({
    sid: "s-fork1",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "seed the fork",
    runDir: true,
    spawner,
  })
  assert.deepEqual(forkSeedOf(job), spawner)

  const unattended = createJob({
    sid: "s-fork2",
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "no levy",
    runDir: true,
  })
  assert.equal(forkSeedOf(unattended), null)
})

test("forkPrompt carries the wake and names the checkpoint", () => {
  const text = forkPrompt({
    wake: { message: `spur for task "prove it" done — check /run/report.json` },
    seed: { tool: "opencode", session_id: "ses_01abc", since: SINCE },
    jid: "j-abc123",
  })
  assert.match(text, /^\[wake\] spur for task "prove it" done/)
  assert.match(text, /opencode:ses_01abc/)
  assert.match(text, new RegExp(SINCE))
  assert.match(text, /j-abc123/)
})

test("a pi seed resolves by header id across cwd directories", () => {
  const dir = join(piRoot, "--Users-x-proj--")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "a.jsonl")
  writeFileSync(file, `${JSON.stringify({ type: "session", id: "u1", timestamp: SINCE, cwd: "/Users/x/proj" })}\n`)
  writeFileSync(join(dir, "b.jsonl"), `${JSON.stringify({ type: "session", id: "u2", timestamp: SINCE })}\n`)

  assert.equal(seedSessionFile({ tool: "pi", session_id: "u1" }), file)
  assert.equal(seedSessionFile({ tool: "pi", session_id: "u9" }), null)
  assert.equal(admitFork({ seed: { tool: "pi", session_id: "u1", session_file: file }, fileExists: (p) => p === file }).admit, true)
})

test("an opencode seed resolves against the db row", () => {
  const db = new DatabaseSync(process.env.OPENCODE_DB!)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.prepare("INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)").run("ses_db1", "/tmp/proj", 1)
  db.close()

  assert.equal(seedSessionFile({ tool: "opencode", session_id: "ses_db1" }), process.env.OPENCODE_DB)
  assert.equal(seedSessionFile({ tool: "opencode", session_id: "ses_missing" }), null)
  assert.equal(seedSessionFile({ tool: "dsh", session_id: "x" }), null)
})
