import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const root = mkdtempSync(join(tmpdir(), "agentic-os-tr-"))
process.env.PI_SESSIONS_ROOT = join(root, "pi-sessions")

// a fake opencode CLI (fallback path): prints a fixture session list
const ocBin = join(root, "opencode-fake")
const ocFixture = join(root, "oc-sessions.json")
writeFileSync(
  ocBin,
  `#!/usr/bin/env bash
if [ "$1" = "session" ]; then cat '${ocFixture}'; else echo "transcript of $2"; fi
`,
)
chmodSync(ocBin, 0o755)
process.env.OPENCODE_BIN = ocBin
// a fixture opencode sqlite db (primary path) — absent until the db test
process.env.OPENCODE_DB = join(root, "no-such-db.sqlite")

const { piEncodeCwd, resolvePi, resolveOpencode, resolveTranscript } = await import("../src/transcripts.ts")

test("pi cwd encoding matches pi's real directory names (no leading dash)", () => {
  assert.equal(piEncodeCwd("/Users/sagebot/x"), "Users-sagebot-x")
  assert.equal(`--${piEncodeCwd("/Users/sagebot/x")}--`, "--Users-sagebot-x--")
})

function piSession(cwd: string, id: string, ts: string, body = "hello") {
  const dir = join(process.env.PI_SESSIONS_ROOT!, `--${piEncodeCwd(cwd)}--`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `20260930_${id}.jsonl`)
  writeFileSync(path, `${JSON.stringify({ type: "session", id, timestamp: ts, cwd })}\n${JSON.stringify({ type: "message", body })}\n`)
  return path
}

test("pi resolves the newest session for the cwd since the pointer instant", () => {
  const cwd = "/tmp/units/europe"
  const older = piSession(cwd, "uuid-old", "2026-09-30T06:00:00.000Z", "older run")
  const newer = piSession(cwd, "uuid-new", "2026-09-30T06:05:00.000Z", "the worker")
  piSession("/tmp/units/other", "uuid-elsewhere", "2026-09-30T06:06:00.000Z") // different cwd

  const hit = resolvePi({ tool: "pi", cwd, since: "2026-09-30T06:01:00.000Z" })
  assert.equal(hit?.id, "uuid-new")
  assert.equal(hit?.path, newer)
  assert.notEqual(hit?.path, older)

  // nothing since that instant — nothing resolves
  assert.equal(resolvePi({ tool: "pi", cwd, since: "2026-09-30T07:00:00.000Z" }), null)
})

test("pi ignores files whose first line is not a session header", () => {
  const cwd = "/tmp/units/asia"
  const dir = join(process.env.PI_SESSIONS_ROOT!, `--${piEncodeCwd(cwd)}--`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "junk.jsonl"), "not json\n")
  piSession(cwd, "uuid-asia", "2026-09-30T06:00:00.000Z")
  assert.equal(resolvePi({ tool: "pi", cwd, since: "2026-09-30T05:00:00.000Z" })?.id, "uuid-asia")
})

test("opencode resolves by directory and creation time via the CLI fallback", () => {
  writeFileSync(
    ocFixture,
    JSON.stringify([
      { id: "ses_old", directory: "/tmp/units/asia", created: Date.parse("2026-09-30T05:00:00.000Z") },
      { id: "ses_new", directory: "/tmp/units/asia", created: Date.parse("2026-09-30T06:00:00.000Z") },
      { id: "ses_elsewhere", directory: "/tmp/other", created: Date.parse("2026-09-30T06:30:00.000Z") },
    ]),
  )
  const hit = resolveOpencode({ tool: "opencode", cwd: "/tmp/units/asia", since: "2026-09-30T05:30:00.000Z" })
  assert.equal(hit?.id, "ses_new")
  assert.equal(resolveOpencode({ tool: "opencode", cwd: "/tmp/units/asia", since: "2026-09-30T06:30:00.000Z" }), null)
})

test("opencode prefers the sqlite db and no CLI window can hide a session", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const dbPath = join(root, "oc-fixture.db")
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER)")
  const insert = (id: string, directory: string, ts: number) =>
    db.prepare("INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)").run(id, directory, ts)
  insert("ses_db_old", "/tmp/units/europe", Date.parse("2026-09-30T05:00:00.000Z"))
  insert("ses_db_new", "/tmp/units/europe", Date.parse("2026-09-30T06:00:00.000Z"))
  insert("ses_db_elsewhere", "/tmp/other", Date.parse("2026-09-30T06:30:00.000Z"))
  db.close()
  process.env.OPENCODE_DB = dbPath

  const hit = resolveOpencode({ tool: "opencode", cwd: "/tmp/units/europe", since: "2026-09-30T05:30:00.000Z" })
  assert.equal(hit?.id, "ses_db_new")
  assert.equal(resolveOpencode({ tool: "opencode", cwd: "/tmp/units/europe", since: "2026-09-30T06:30:00.000Z" }), null)

  process.env.OPENCODE_DB = join(root, "no-such-db.sqlite") // restore fallback for later tests
})

test("opencode session_v2 is the live table — a post-migration session resolves (the p10 wake regression)", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const dbPath = join(root, "oc-v2-fixture.db")
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER)")
  db.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER)")
  const ins = (table: string, id: string, directory: string, ts: number) =>
    db.prepare(`INSERT INTO ${table} (id, directory, time_created) VALUES (?, ?, ?)`).run(id, directory, ts)
  ins("session", "ses_legacy", "/tmp/units/v2", Date.parse("2026-10-11T00:00:00.000Z"))
  // post-migration: the levy session lives ONLY in session_v2 — legacy
  // froze at the migration instant, exactly like the real 2026-10-12 db
  ins("session_v2", "ses_v2_levy", "/tmp/units/v2", Date.parse("2026-10-12T09:50:00.000Z"))
  db.close()
  process.env.OPENCODE_DB = dbPath

  const hit = resolveOpencode({ tool: "opencode", cwd: "/tmp/units/v2", since: "2026-10-12T00:00:00.000Z" })
  assert.equal(hit?.id, "ses_v2_levy", "the newest session lives only in session_v2")
  assert.equal(resolveOpencode({ tool: "opencode", cwd: "/tmp/units/v2", since: "2026-10-13T00:00:00.000Z" }), null)

  const { opencodeSessionExists, seedSessionFile } = await import("../src/transcripts.ts")
  assert.equal(opencodeSessionExists("ses_v2_levy"), true, "the fork seed check sees v2 rows")
  assert.equal(opencodeSessionExists("ses_legacy"), true, "legacy rows stay visible")
  assert.equal(opencodeSessionExists("ses_missing"), false)
  assert.equal(seedSessionFile({ tool: "opencode", session_id: "ses_v2_levy" }), dbPath, "the fork seed resolves")

  process.env.OPENCODE_DB = join(root, "no-such-db.sqlite") // restore fallback for later tests
})

test("an install without session_v2 still resolves through legacy session", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const dbPath = join(root, "oc-legacy-only.db")
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER)")
  db.prepare("INSERT INTO session (id, directory, time_created) VALUES (?, ?, ?)").run(
    "ses_old_install", "/tmp/units/old", Date.parse("2026-09-30T06:00:00.000Z"),
  )
  db.close()
  process.env.OPENCODE_DB = dbPath
  const hit = resolveOpencode({ tool: "opencode", cwd: "/tmp/units/old", since: "2026-09-30T05:00:00.000Z" })
  assert.equal(hit?.id, "ses_old_install")
  const { opencodeSessionExists } = await import("../src/transcripts.ts")
  assert.equal(opencodeSessionExists("ses_old_install"), true)
  process.env.OPENCODE_DB = join(root, "no-such-db.sqlite")
})

test("resolveTranscript reads pi bytes directly and exports opencode bytes", async () => {
  piSession("/tmp/units/europe", "uuid-read", "2026-09-30T06:10:00.000Z", "the actual work")
  const pi = resolveTranscript({ tool: "pi", cwd: "/tmp/units/europe", since: "2026-09-30T05:00:00.000Z" })
  assert.equal(pi?.tool, "pi")
  assert.ok(pi!.read().includes("the actual work"))

  writeFileSync(ocFixture, JSON.stringify([{ id: "ses_x", directory: "/tmp/units/europe", created: Date.now() }]))
  const oc = resolveTranscript({ tool: "opencode", cwd: "/tmp/units/europe", since: "2026-09-30T00:00:00.000Z" })
  assert.equal(oc?.id, "ses_x")
  assert.ok(oc!.read().includes("transcript of ses_x"))
})

test("opencodeSessionTitle reads the live session_v2 title (the parent-pane guard's identity half)", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const dbPath = join(root, "oc-title.db")
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT)")
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY)")
  db.prepare("INSERT INTO session_v2 (id, title) VALUES (?, ?)").run("ses_t", "the p10 pipeline plan")
  db.close()
  const prev = process.env.OPENCODE_DB
  process.env.OPENCODE_DB = dbPath
  const { opencodeSessionTitle } = await import("../src/transcripts.ts")
  try {
    assert.equal(opencodeSessionTitle("ses_t"), "the p10 pipeline plan")
    assert.equal(opencodeSessionTitle("ses_unknown"), null, "unknown session — no title, the guard stands down")
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prev
  }
})

test.after(() => {
  rmSync(root, { recursive: true, force: true })
})
