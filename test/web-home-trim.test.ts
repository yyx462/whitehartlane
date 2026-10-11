// home trim, proved at the API: /api/home ships the KPI row, the
// 14-day runs-per-day chart and the permission mix — and no
// durationTrend (the per-spur trend panels are gone; the payload
// carries no dead weight). Fixture disk in the shape of src/store.ts,
// server spawned like the other web tests.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webhome"

type FixtureJob = {
  jid: string
  state: string
  created: string
  finished?: string
}

function isoAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

function fixtureRoot(jobs: FixtureJob[]): string {
  const root = mkdtempSync(join(tmpdir(), "aos-web-home-"))
  const sdir = join(root, "sessions", SID)
  mkdirSync(sdir, { recursive: true })
  writeFileSync(join(sdir, "session.json"), JSON.stringify({ id: SID, created: isoAgo(48), cwd: "/tmp", host: null }))
  writeFileSync(
    join(sdir, "events.jsonl"),
    [
      { ts: isoAgo(40), kind: "permission", jid: jobs[0]?.jid ?? "", decision: "allow" },
      { ts: isoAgo(39), kind: "permission", jid: jobs[0]?.jid ?? "", decision: "deny" },
      { ts: isoAgo(20), kind: "permission", jid: jobs[1]?.jid ?? "", decision: "allow" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n",
  )
  for (const j of jobs) {
    const jobDir = join(sdir, "jobs", j.jid)
    const runDir = join(jobDir, "run")
    mkdirSync(join(runDir, "members"), { recursive: true })
    writeFileSync(join(runDir, "workflow.toml"), '[workflow]\nname = "home"\nspur_id = "home"\nkind = "coworker"\n')
    writeFileSync(join(runDir, "members", "solo.md"), "You are solo.\n")
    writeFileSync(
      join(jobDir, "job.json"),
      JSON.stringify({
        id: j.jid,
        sid: SID,
        state: j.state,
        created: j.created,
        ...(j.finished ? { finished: j.finished } : {}),
        dir: runDir,
        workflow: "coworker",
        panes: [],
        spur: {
          project: "p-webhome",
          project_name: "home-fixture",
          spur_id: "home",
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

test("/api/home ships KPIs, runsPerDay and permissionMix — and no durationTrend", async (t) => {
  const root = fixtureRoot([
    { jid: "j-done01", state: "retired", created: isoAgo(30), finished: isoAgo(29) },
    { jid: "j-done02", state: "retired", created: isoAgo(20), finished: isoAgo(18) },
    { jid: "j-live01", state: "running", created: isoAgo(1) },
    { jid: "j-old001", state: "retired", created: isoAgo(24 * 9), finished: isoAgo(24 * 9 - 1) },
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

  const res = await fetch(`http://127.0.0.1:${port}/api/home`)
  assert.equal(res.status, 200)
  const home = (await res.json()) as Record<string, unknown>

  // the trim: the field is GONE, not empty — no dead weight shipped
  assert.ok(!("durationTrend" in home), "durationTrend removed from the payload")
  assert.equal(JSON.stringify(home).includes("durationTrend"), false)

  // what stays: the KPI row, the runs-per-day chart, the permission mix
  const kpis = home.kpis as Record<string, unknown>
  for (const k of ["jobs24h", "successRate24h", "avgDuration24h", "runningNow", "orphanedNow"]) {
    assert.ok(k in kpis, `kpis.${k} still shipped`)
  }
  const runsPerDay = home.runsPerDay as { day: string }[]
  assert.equal(runsPerDay.length, 14, "14 day buckets")
  const permissionMix = home.permissionMix as Record<string, number>
  assert.equal(permissionMix.allow, 2)
  assert.equal(permissionMix.deny, 1)
})
