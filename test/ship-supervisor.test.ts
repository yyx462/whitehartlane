// ship-supervisor — the parentless commission's owner (2026-10-30):
// `gwt submit-pr` from a plain terminal has no session to wake, so the
// door mints one. Pinned here: the brief is a CONTRACT (the levy runs
// verbatim in a tracked background shell, the verdict reaches the PR,
// the supervisor stops), and the spawn is testable through a stub bin.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { q, spawnSupervisor, supervisorBrief } from "../src/doors/ship-supervisor.ts"

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
