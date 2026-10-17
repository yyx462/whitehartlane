// perf — doorNowRev answers the checkout's OWN rev: identical for every
// job in a response. It must not run one sync `git rev-parse` per job
// per request: under launchd the server resolves `git` to /usr/bin/git
// (an xcrun shim, ~0.4s per spawn in that context), so a 160-job disk
// froze the single-threaded server for a minute+ on every /api/jobs
// poll — every other request, even /api/health, queued behind it. The
// rev is checkout metadata: one spawn per TTL window is plenty. Proved
// by counting spawns through a PATH shim.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-doorrev"
const JOBS = 5 // pre-fix this means 5 spawns per request; 10 for two

function jobJson(jid: string, created: string): string {
  return JSON.stringify({
    id: jid,
    sid: SID,
    state: "retired",
    created,
    finished: created,
    dir: join(tmpdir(), "aos-doorrev-run"),
    workflow: "coworker",
    panes: [],
    spur: { project: "p-doorrev", project_name: "doorrev-fixture", spur_id: "cache", content_hash: "h1", source: "/gone" },
  })
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aos-doorrev-"))
  const sdir = join(root, "sessions", SID)
  const jdir = join(sdir, "jobs")
  mkdirSync(sdir, { recursive: true })
  mkdirSync(join(sdir), { recursive: true })
  writeFileSync(join(sdir, "session.json"), JSON.stringify({ id: SID, created: "2026-10-17T00:00:00Z", cwd: "/tmp", host: null }))
  for (let i = 0; i < JOBS; i++) {
    const jid = `j-job00${i + 1}`
    mkdirSync(join(jdir, jid), { recursive: true })
    writeFileSync(join(jdir, jid, "job.json"), jobJson(jid, `2026-10-17T0${i + 1}:00:00Z`))
  }
  return root
}

async function waitHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error("server did not come up")
}

test("doorNowRev spawns git once per TTL window, not once per job per request", async (t) => {
  const root = fixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // a PATH shim that logs every git invocation and answers a rev
  const shim = mkdtempSync(join(tmpdir(), "aos-doorrev-shim-"))
  const log = join(shim, "calls.log")
  writeFileSync(join(shim, "git"), `#!/bin/sh\nprintf 'call\\n' >> ${JSON.stringify(log)}\nprintf 'abc1234\\n'\n`)
  chmodSync(join(shim, "git"), 0o755)
  t.after(() => rmSync(shim, { recursive: true, force: true }))

  const port = 21000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [resolve("web/server.mjs")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      AGENTIC_OS_ROOT: root,
      AGENTIC_OS_DOOR: "/nonexistent-door",
      PATH: shim + delimiter + (process.env.PATH ?? ""),
    },
    stdio: "ignore",
  })
  t.after(() => child.kill())
  await waitHealthy(port)

  const jobs = async () => ((await (await fetch(`http://127.0.0.1:${port}/api/jobs`)).json()) as { jobs?: { id: string }[] }).jobs ?? []
  assert.equal((await jobs()).length, JOBS, "baseline: the fixture holds all jobs")
  assert.equal((await jobs()).length, JOBS, "second poll inside the TTL window")

  const calls = readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).length
  assert.equal(
    calls,
    1,
    `one git spawn per TTL window (got ${calls}; pre-fix this was ${JOBS} per request, ${JOBS * 2} for two)`,
  )
})
