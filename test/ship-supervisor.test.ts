// ship-supervisor — the parentless commission's owner (2026-10-30):
// `gwt submit-pr` from a plain terminal has no session to wake, so the
// door mints one. Pinned here: the brief is a CONTRACT (the levy runs
// verbatim in a tracked background shell, the verdict reaches the PR,
// the supervisor stops), and the spawn is testable through a stub bin.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { q, resolveCaller, spawnSupervisor, supervisorBrief } from "../src/doors/ship-supervisor.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("q: single-quote shell escaping keeps the spell one argument", () => {
  assert.equal(q("plain"), "'plain'")
  assert.equal(q("it's"), "'it'\\''s'")
  // the receipt is the SHELL's own read-back, not string surgery: the
  // quoted form survives a real /bin/sh as one argv-shaped word
  const roundTrip = (s: string) => execSync(`printf %s ${q(s)}`, { encoding: "utf8", shell: "/bin/sh" })
  assert.equal(roundTrip("a 'quoted' title"), "a 'quoted' title")
  assert.equal(roundTrip("it's"), "it's")
})

test("supervisorBrief: the whole commission, copy-safe", () => {
  const b = supervisorBrief({ levyCmd: "whl review /repo --base master --head feat --model 'acme/strong' --unattended", runDir: "/run", pr: "42", repo: "/repo" })
  // the levy rides verbatim — the supervisor never re-spells it
  assert.ok(b.includes("whl review /repo --base master --head feat --model 'acme/strong' --unattended"))
  // the wake law, stated to the hearer: tracked background shell, never detached
  assert.match(b, /tracked background shell/)
  assert.match(b, /NEVER nohup/)
  // the verdict reaches the PR; the hearer stops
  assert.match(b, /gh pr comment 42/)
  assert.match(b, /\/run\/data\/review\/verdict\.json/)
  assert.match(b, /do NOT merge again/)
  assert.match(b, /STOP/)
})

test("spawnSupervisor: detached spawn with run --standalone and a tailed log", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-supervisor-"))
  const bin = join(tmp, "stub-opencode")
  // the stub records its argv; its stdout flows to the inherited log fd
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${tmp}/argv.txt\necho "supervisor up"\n`,
  )
  chmodSync(bin, 0o755)
  const out = join(tmp, "run")
  const s = spawnSupervisor({ brief: "BRIEF-CONTENT", cwd: tmp, logPath: join(out, "supervisor.log"), bin })
  assert.ok(s.ok, `the spawn must succeed against a real stub bin (why: ${s.ok ? "" : s.why})`)
  if (!s.ok) return
  assert.ok(s.pid > 0, "a real pid came back")
  let argv = ""
  for (let i = 0; i < 40 && !argv; i++) {
    await sleep(50)
    if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
  }
  const lines = argv.trim().split("\n")
  assert.deepEqual(lines.slice(0, 2), ["run", "--standalone"], "the one-shot form")
  assert.equal(lines[2], "BRIEF-CONTENT", "the brief is the message")
  // the log the caller tails got the stub's stdout
  let log = ""
  for (let i = 0; i < 20 && !log; i++) {
    await sleep(50)
    if (existsSync(join(out, "supervisor.log"))) log = readFileSync(join(out, "supervisor.log"), "utf8")
  }
  assert.match(log, /supervisor up/)
  rmSync(tmp, { recursive: true, force: true })
})

test("spawnSupervisor: an unspawnable bin is infra-as-infra (questions-18's unit twin)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-supervisor-dead-"))
  const s = spawnSupervisor({ brief: "x", cwd: tmp, logPath: join(tmp, "l.log"), bin: join(tmp, "definitely-absent") })
  assert.ok(!s.ok, "a missing bin never reports an owned commission")
  assert.match((s as { why: string }).why, /not found/)
  rmSync(tmp, { recursive: true, force: true })
})

// ---- parent resolution: the commissioner is an agent most of the
// time; the supervisor is the RARE fallback (2026-10-30). Pinned here:
// the evidence order and what each tier requires.
const stubBin = (dir: string, name: string, out: string): string => {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(p, 0o755)
  return p
}

test("resolveCaller: the harness's own env id is final", () => {
  const c = resolveCaller("/anywhere", { env: { OPENCODE_SESSION_ID: "ses_direct" } })
  assert.deepEqual(c, { from: "opencode:ses_direct", via: "env OPENCODE_SESSION_ID" })
})

test("resolveCaller: herdr's opencode pane + the project's newest session", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-caller-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo)
  const herdr = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "opencode" } } }))
  const sessions = JSON.stringify([
    { id: "ses_new", directory: repo, updated: 1793339266367 },
    { id: "ses_old", directory: repo, updated: 1 },
  ])
  const oc = stubBin(tmp, "oc", sessions)
  // the caller's cwd is a real worktree under the session's project —
  // execFileSync spawns WITH it, so it must exist
  mkdirSync(join(repo, "wt-x"))
  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: oc }
  // newest-first list, ancestor directory → the newest binds
  const c = resolveCaller(join(repo, "wt-x"), { env, now: 1793339266367 + 45_000 })
  assert.equal(c?.from, "opencode:ses_new")
  assert.match(c?.via ?? "", /herdr pane wK:pSV/)
  // a session rooted OUTSIDE this cwd never binds (the wake stays in
  // the commissioning project)
  const foreign = stubBin(tmp, "oc2", JSON.stringify([{ id: "ses_other", directory: "/elsewhere", updated: 9e15 }]))
  assert.equal(resolveCaller(repo, { env: { ...env, WHL_OPENCODE_BIN: foreign } }), null)
  rmSync(tmp, { recursive: true, force: true })
})

test("resolveCaller: the coworker law — an equally fresh sibling REFUSES the bind", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-caller-cw-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo)
  const herdr = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "opencode" } } }))
  const now = 1793339266367
  // a whl fan-out: two members, same project, both mid-turn
  const busy = stubBin(tmp, "oc-busy", JSON.stringify([
    { id: "ses_a", directory: repo, updated: now },
    { id: "ses_b", directory: repo, updated: now - 60_000 },
  ]))
  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: busy }
  assert.equal(resolveCaller(repo, { env, now: now + 30_000 }), null, "newest is not identity while a sibling is fresh — guessing the commissioner is the wrong-owner wake")
  // the sibling long quiet: the newest binds again
  const quiet = stubBin(tmp, "oc-quiet", JSON.stringify([
    { id: "ses_a", directory: repo, updated: now },
    { id: "ses_b", directory: repo, updated: now - 45 * 60 * 1000 },
  ]))
  const c = resolveCaller(repo, { env: { ...env, WHL_OPENCODE_BIN: quiet }, now: now + 30_000 })
  assert.equal(c?.from, "opencode:ses_a")
  assert.match(c?.via ?? "", /siblings quiet/)
  rmSync(tmp, { recursive: true, force: true })
})

test("resolveCaller: a NON-opencode pane, a dead herdr, no herdr — all null (the supervisor's cases)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-caller2-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo)
  const sessions = JSON.stringify([{ id: "ses_x", directory: repo, updated: 9e15 }])
  const oc = stubBin(tmp, "oc", sessions)
  // herdr says the pane runs something else — the session list is NOT
  // trusted (the wake must reach the commissioner, not a neighbor)
  const claude = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "claude-code" } } }))
  assert.equal(resolveCaller(repo, { env: { HERDR_ENV: "1", HERDR_PANE_ID: "p", WHL_HERDR_BIN: claude, WHL_OPENCODE_BIN: oc } }), null)
  // no herdr env at all: a bare terminal NEVER auto-binds, however
  // fresh the sessions look — that path mints the supervisor
  assert.equal(resolveCaller(repo, { env: { WHL_OPENCODE_BIN: oc } }), null)
  // herdr present but broken (unparsable): guarded, still null
  const dead = stubBin(tmp, "herdr-dead", "not json")
  assert.equal(resolveCaller(repo, { env: { HERDR_ENV: "1", HERDR_PANE_ID: "p", WHL_HERDR_BIN: dead, WHL_OPENCODE_BIN: oc } }), null)
  rmSync(tmp, { recursive: true, force: true })
})

