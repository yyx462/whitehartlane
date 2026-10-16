// C06 — the scan cache, proved at the API: GETs within the TTL share
// one disk walk (an external write — a running orchestrator, not the
// server — surfaces within the TTL, not instantly), and any POST busts
// the cache BEFORE routing, so even a POST that 404s makes the next
// poll see the verb's effect. The polling UI stops paying a full OS
// disk walk per GET.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webcache"

function jobJson(jid: string, created: string): string {
  return JSON.stringify({
    id: jid,
    sid: SID,
    state: "retired",
    created,
    finished: created,
    dir: join(tmpdir(), "aos-webcache-run"),
    workflow: "coworker",
    panes: [],
    spur: { project: "p-webcache", project_name: "cache-fixture", spur_id: "cache", content_hash: "h1", source: "/gone" },
  })
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aos-web-cache-"))
  const sdir = join(root, "sessions", SID)
  const jdir = join(sdir, "jobs")
  mkdirSync(join(jdir, "j-one001", "run", "members"), { recursive: true })
  writeFileSync(join(sdir, "session.json"), JSON.stringify({ id: SID, created: "2026-10-17T00:00:00Z", cwd: "/tmp", host: null }))
  writeFileSync(join(jdir, "j-one001", "job.json"), jobJson("j-one001", "2026-10-17T01:00:00Z"))
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

test("GETs share the scan within the TTL; any POST busts it for the next poll", async (t) => {
  const root = fixtureRoot()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const port = 21000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [resolve("web/server.mjs")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      AGENTIC_OS_ROOT: root,
      AGENTIC_OS_DOOR: "/nonexistent-door",
    },
    stdio: "ignore",
  })
  t.after(() => child.kill())
  await waitHealthy(port)

  const jobs = async () => ((await (await fetch(`http://127.0.0.1:${port}/api/jobs`)).json()) as { jobs?: { id: string }[] }).jobs ?? []

  assert.equal((await jobs()).length, 1, "baseline: the fixture holds one job")

  // an EXTERNAL write (the orchestrator's disk, not the server's own
  // verb) lands mid-TTL — the next GET inside the window must NOT pay
  // a walk, so it stays on the cached answer
  mkdirSync(join(root, "sessions", SID, "jobs", "j-two002"), { recursive: true })
  writeFileSync(join(root, "sessions", SID, "jobs", "j-two002", "job.json"), jobJson("j-two002", "2026-10-17T02:00:00Z"))
  assert.equal((await jobs()).length, 1, "within the TTL the external write is not yet visible — one walk per window")

  // any POST busts before routing — even one that 404s afterwards
  const bust = await fetch(`http://127.0.0.1:${port}/api/__cache_bust`, { method: "POST" })
  assert.equal(bust.status, 404, "the busting POST itself may 404 — the bust already ran")
  assert.equal((await jobs()).length, 2, "after the bust the next poll sees the external write")
})
