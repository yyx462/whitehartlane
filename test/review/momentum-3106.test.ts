// momentum-3106 — the janitor's receipt: every kill lands in a
// rotating kill log an agent can trace from. The 2026-11-04 ask: most
// things the janitor kills SHOULD NOT HAPPEN — a kill means a
// commission died uncleanly, so the log entry must be enough to start
// the trace (who minted, where the world was, how old, what to read
// next), and the log must rotate so a chatty failure cannot eat the
// disk. Pinned here: entry shape on a kill, silence on a clean sweep,
// rotation, and the hermetic kill-log path (AGENTIC_OS_HOME honored).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { killLogPath, rotateKillLog, sweepZombies } from "../../src/doors/watcher-sweep.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const alive = (pid?: number): boolean => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitDead = async (pid: number | undefined, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await sleep(100)
  }
  return !alive(pid)
}

test("a janitor kill leaves one traceable entry; a clean sweep writes nothing; the log rotates", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3106-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  const prevHome = process.env.AGENTIC_OS_HOME
  let pid: number | undefined
  try {
    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all

    for (const name of ["stub-opencode", "notify", "gh"]) {
      writeFileSync(join(tmp, name), "#!/bin/sh\nexit 0\n")
      chmodSync(join(tmp, name), 0o755)
    }
    writeFileSync(join(tmp, "orch-stub.mjs"), "export default {}\n")
    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    // hermetic default path: the kill log lives under the OS home, and
    // the OS home follows AGENTIC_OS_HOME (the janitor's diary must
    // never point at a real disk from inside a test)
    process.env.AGENTIC_OS_HOME = join(tmp, "os-home")
    assert.equal(killLogPath(), join(tmp, "os-home", "janitor.log.jsonl"), "killLogPath must resolve under AGENTIC_OS_HOME")

    const out = join(tmp, "auto-reviews", "pr61")
    mkdirSync(join(out, "data", "review"), { recursive: true })
    const s = supervisor.spawnSupervisor({
      brief: "BRIEF",
      cwd: join(tmp, "auto-reviews"),
      logPath: `${out}.supervisor.log`,
      bin: join(tmp, "stub-opencode"),
      outDir: out,
      pr: "61",
      repo: tmp,
    })
    assert.ok(s.ok, `the spawn must succeed (why: ${s.ok ? "" : s.why})`)
    pid = s.pid

    const killLog = join(tmp, "kills.jsonl")

    // A CLEAN SWEEP WRITES NOTHING — a healthy pass leaves no trace
    const untouched = sweepZombies({ onlyPids: [Number.MAX_SAFE_INTEGER], actor: "pin", killLog })
    assert.equal(untouched, 0, "a sweep that kills nothing must return 0")
    assert.ok(!existsSync(killLog), "a sweep that kills nothing must not create the kill log")

    // A KILL LEAVES ONE TRACEABLE ENTRY
    const killed = sweepZombies({ onlyPids: [pid], actor: "janitor", killLog })
    assert.equal(killed, 1, "the scoped sweep must reap exactly the one fixture watcher")
    assert.ok(await waitDead(pid, 5000), "the watcher must die by the sweep's hand")
    const lines = readFileSync(killLog, "utf8").split("\n").filter((l) => l.trim())
    assert.equal(lines.length, 1, `exactly one entry per kill (got ${lines.length})`)
    const entry = JSON.parse(lines[0])
    assert.equal(entry.actor, "janitor", "the entry names WHO swept")
    assert.equal(entry.pid, pid, "the entry names the pid")
    assert.match(entry.rule, /^lane-final-fixture$|^world-gone-orphan$|^aged-fixture-orphan$/, "the entry names the rule that fired")
    assert.ok(String(entry.script).endsWith(".log.watch"), "the entry pins the exact watch script")
    assert.equal(entry.world, join(tmp, "auto-reviews"), "the entry names the world dir — where the commission lived")
    assert.ok(Array.isArray(entry.trace) && entry.trace.length === 3, "the entry carries three trace pointers (world, brief, notify diary)")
    assert.match(String(entry.symptom), /uncleanly/, "the entry states the symptom in words an agent reads first")

    // ROTATION — a chatty failure must not eat the disk: past the size
    // cap the current file becomes .1 and the oldest generation falls off
    const rot = join(tmp, "rot.jsonl")
    writeFileSync(rot, "first\n")
    rotateKillLog(rot, 1)
    assert.ok(existsSync(`${rot}.1`), "an oversized log rotates to .1")
    writeFileSync(rot, "second\n")
    rotateKillLog(rot, 1)
    assert.ok(existsSync(`${rot}.2`), "the second rotation shifts .1 to .2")
    assert.equal(readFileSync(`${rot}.2`, "utf8"), "first\n", "generations keep their order (oldest falls off last)")
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
