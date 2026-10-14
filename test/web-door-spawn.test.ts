// The launchd PATH bug (j-389b25): the window server runs under
// launchd on macOS's minimal PATH — no node, no ~/.local/bin — so
// spawning the door script hit its `#!/usr/bin/env node` shebang and
// died with "env: node: No such file or directory" (a UI abort of the
// marketplace-port spur). Proved end to end: the server runs on a
// stripped PATH, and a UI abort still reaches the door, kills the
// orchestrator pid, and books the abort on the fixture OS disk.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webdoor"

function fixtureRunningJob(root: string, jid: string, pid: number) {
  const jobDir = join(root, "sessions", SID, "jobs", jid)
  const runDir = join(jobDir, "run")
  mkdirSync(join(runDir, "members"), { recursive: true })
  writeFileSync(join(runDir, "workflow.toml"), '[workflow]\nname = "door"\nspur_id = "door"\nkind = "coworker"\n')
  writeFileSync(join(runDir, "members", "solo.md"), "You are solo.\n")
  writeFileSync(
    join(jobDir, "job.json"),
    JSON.stringify({
      id: jid,
      sid: SID,
      state: "running",
      created: new Date().toISOString(),
      dir: runDir,
      workflow: "coworker",
      panes: [],
      pid,
      spur: {
        project: "p-door",
        project_name: "door",
        spur_id: "door",
        content_hash: "x",
        source: join(tmpdir(), "aos-door-src-" + Date.now()),
        labels: {},
      },
    }),
  )
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

test("a UI verb survives launchd's minimal PATH (j-389b25)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-web-door-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  // the "orchestrator": a live pid the door must SIGKILL
  const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" })
  t.after(() => {
    try {
      sleeper.kill("SIGKILL")
    } catch {}
  })
  const exited = new Promise<boolean>((res) => sleeper.once("exit", () => res(true)))
  const jid = "j-door01"
  fixtureRunningJob(root, jid, sleeper.pid!)

  const port = 21000 + Math.floor(Math.random() * 20000)
  // launchd-style env: PATH has NO node and NO ~/.local/bin
  const child = spawn(process.execPath, [resolve("web/server.mjs")], {
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      PORT: String(port),
      HOST: "127.0.0.1",
      AGENTIC_OS_ROOT: root,
      AGENTIC_OS_HOME: root,
    },
    stdio: "ignore",
  })
  t.after(() => child.kill())
  await waitHealthy(port)

  const res = await fetch(`http://127.0.0.1:${port}/api/job/${SID}/${jid}/abort`, { method: "POST" })
  const body = (await res.json()) as { ok?: boolean; error?: string }
  assert.equal(res.status, 200, `abort came back ${res.status}: ${JSON.stringify(body)}`)
  assert.equal(body.ok, true)
  assert.doesNotMatch(String(body.error ?? ""), /env: node/)

  // the abort really ran: the sleeper died, the Job is booked aborted
  assert.equal(await exited, true)
  const job = JSON.parse(readFileSync(join(root, "sessions", SID, "jobs", jid, "job.json"), "utf8")) as {
    state: string
  }
  assert.equal(job.state, "aborted")
})
