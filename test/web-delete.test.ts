// v6 — the delete verb, proved against a fixture OS disk: delete is
// pure spur file removing (the job dir + its staged run/ leave the
// disk), a live run is refused with 409 and keeps its files, an
// unknown job is a 404, and a sibling job in the same session is
// untouched. No booking, no CLI door — the endpoint owns the rm.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webdel"

type FixtureJob = {
  jid: string
  state: string
  created: string
}

function fixtureRoot(jobs: FixtureJob[]): string {
  const root = mkdtempSync(join(tmpdir(), "aos-web-del-"))
  for (const j of jobs) {
    const jobDir = join(root, "sessions", SID, "jobs", j.jid)
    const runDir = join(jobDir, "run")
    mkdirSync(join(runDir, "members"), { recursive: true })
    writeFileSync(join(runDir, "workflow.toml"), '[workflow]\nname = "del"\nspur_id = "del"\nkind = "coworker"\n')
    writeFileSync(join(runDir, "members", "solo.md"), "You are solo.\n")
    writeFileSync(
      join(jobDir, "job.json"),
      JSON.stringify({
        id: j.jid,
        sid: SID,
        state: j.state,
        created: j.created,
        dir: runDir,
        workflow: "coworker",
        panes: [],
        spur: {
          project: "p-webdel",
          project_name: "del-fixture",
          spur_id: "del",
          content_hash: "hash1",
          source: join(tmpdir(), "aos-gone-source-" + Date.now()),
        },
      }),
    )
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

async function deleteJob(port: number, sid: string, jid: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/job/${sid}/${jid}/delete`, { method: "POST" })
}

test("delete removes a parked job's files, refuses a live run, leaves siblings alone", async (t) => {
  const root = fixtureRoot([
    { jid: "j-park01", state: "aborted", created: "2026-10-01T00:00:00.000Z" },
    { jid: "j-live01", state: "running", created: "2026-10-02T00:00:00.000Z" },
    { jid: "j-done01", state: "retired", created: "2026-10-03T00:00:00.000Z" },
  ])
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

  // unknown job -> 404
  const missing = await deleteJob(port, SID, "j-nope00")
  assert.equal(missing.status, 404)

  // live run -> 409, and not one file moved
  const liveDir = join(root, "sessions", SID, "jobs", "j-live01")
  const live = await deleteJob(port, SID, "j-live01")
  assert.equal(live.status, 409)
  const liveBody = (await live.json()) as { error?: string }
  assert.match(liveBody.error ?? "", /refusing/)
  assert.ok(existsSync(join(liveDir, "job.json")), "live job keeps its record")

  // parked job (aborted) -> 200, the whole job dir is gone
  const parked = await deleteJob(port, SID, "j-park01")
  assert.equal(parked.status, 200)
  const parkedBody = (await parked.json()) as { ok?: boolean; removed?: string[] }
  assert.equal(parkedBody.ok, true)
  assert.ok(parkedBody.removed?.length, "the removed paths travel back")
  assert.ok(!existsSync(join(root, "sessions", SID, "jobs", "j-park01")), "job dir gone")
  assert.ok(!existsSync(join(root, "sessions", SID, "jobs", "j-park01", "run")), "staged run gone")

  // retired job -> 200 too (success/failed are fair game)
  const done = await deleteJob(port, SID, "j-done01")
  assert.equal(done.status, 200)
  assert.ok(!existsSync(join(root, "sessions", SID, "jobs", "j-done01")))

  // the live sibling is still there, byte for byte
  assert.ok(existsSync(join(liveDir, "run", "workflow.toml")), "sibling untouched")

  // and the job left the listing — job.json was the spur's identity
  const jobsRes = await fetch(`http://127.0.0.1:${port}/api/jobs`)
  const jobs = (await jobsRes.json()) as { jobs: { id: string }[] }
  assert.deepEqual(jobs.jobs.map((j) => j.id), ["j-live01"])
})
