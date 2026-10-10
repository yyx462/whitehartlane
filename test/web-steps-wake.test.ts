// v6 — ADR 0007 drawn: the steps payload carries the full declared
// topology. The chain edges fan wave to wave (every step of wave N to
// every step of wave N+1 it could unblock), the run's shape carries
// its finish states (edge coloring data), and a wake step carries its
// CHILD — jid, state, the receipt outcome, and the child program's own
// steps parsed from the child's staged manifest (the box-in-box). An
// unlevied wake (earlier wave failed) renders hollow with the reason.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webt02"
const CSID = "s-webt02c"

// the nested-wakes shape, widened: a fan-out wave of work, a wake step
// (a whole child program), then a trailing check wave
const PARENT_TOML = `[workflow]
name = "stepsdemo"
dag_id = "stepsdemo"

[hooks]
units = "true"
grade = "true"
counts = "true"

[[step]]
id = "a"
finished_by = "end"
wave = "w1"

[[step]]
id = "b"
finished_by = "end"
wave = "w1"

[[step]]
id = "sub"
finished_by = "wake"
folder = "./child"
wave = "w2"

[[step]]
id = "audit"
finished_by = "check"
check = "true"
wave = "w3"
`

// the child: a complete program with its own [[step]] table
const CHILD_TOML = `[workflow]
name = "child"
dag_id = "child"

[hooks]
units = "true"

[[step]]
id = "x"
finished_by = "end"
wave = "c1"

[[step]]
id = "y"
finished_by = "end"
wave = "c1"

[[step]]
id = "z"
finished_by = "check"
check = "true"
wave = "c2"
`

type JobFixture = {
  sid: string
  jid: string
  created: string
  state?: string
  wakes?: Record<string, unknown> | null
  settled?: { done: string[]; failed: string[] }
}

function writeJob(
  root: string,
  j: JobFixture,
  opts: { toml?: string; dagSource?: string } = {},
) {
  const runDir = join(root, "sessions", j.sid, "jobs", j.jid, "run")
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, "workflow.toml"), opts.toml ?? PARENT_TOML)
  if (j.settled) {
    writeFileSync(join(runDir, "state.json"), JSON.stringify(j.settled, null, 2))
  }
  for (const [step, booking] of Object.entries(j.wakes ?? {})) {
    mkdirSync(join(runDir, "wakes"), { recursive: true })
    writeFileSync(join(runDir, "wakes", `${step}.json`), JSON.stringify(booking, null, 2))
  }
  writeFileSync(
    join(root, "sessions", j.sid, "jobs", j.jid, "job.json"),
    JSON.stringify(
      {
        id: j.jid,
        sid: j.sid,
        stoodUpBy: "standalone",
        workflow: "fan-out",
        task: "stepsdemo",
        dir: runDir,
        state: j.state ?? "retired",
        created: j.created,
        panes: [],
        receipt: { panesRemaining: 0, panesTotal: 0, unitsDone: 4, unitsFailed: 0, status: "done", finished: j.created },
        dag: {
          project: "p-webt2",
          project_name: "steps-webt",
          dag_id: "stepsdemo",
          content_hash: "hash1",
          source: opts.dagSource ?? "/nonexistent/gone-source",
        },
      },
      null,
      2,
    ),
  )
  mkdirSync(join(root, "sessions", j.sid), { recursive: true })
  writeFileSync(
    join(root, "sessions", j.sid, "session.json"),
    JSON.stringify({ id: j.sid, created: j.created, cwd: "/tmp" }),
  )
}

function fixtureRoot(goneSource: string): string {
  const root = mkdtempSync(join(tmpdir(), "aos-web-steps-"))

  // the CHILD job: its own session, staged steps manifest, done receipt
  const childRun = join(root, "sessions", CSID, "jobs", "j-chi01", "run")
  mkdirSync(childRun, { recursive: true })
  writeFileSync(join(childRun, "workflow.toml"), CHILD_TOML)
  writeFileSync(join(childRun, "state.json"), JSON.stringify({ done: ["x", "y", "z"], failed: [] }, null, 2))
  writeFileSync(
    join(childRun, "wake.json"),
    JSON.stringify({
      to: { tool: "rail", session_id: SID, since: "2026-10-03T00:00:05.000Z" },
      jid: "j-chi01",
      task: "child",
      outcome: "done",
      message: "spur for task child done",
      at: "2026-10-03T00:00:09.000Z",
    }, null, 2),
  )
  writeFileSync(
    join(root, "sessions", CSID, "jobs", "j-chi01", "job.json"),
    JSON.stringify(
      {
        id: "j-chi01",
        sid: CSID,
        stoodUpBy: "rail",
        workflow: "fan-out",
        task: "child",
        dir: childRun,
        state: "retired",
        created: "2026-10-03T00:00:05.000Z",
        panes: [],
        spawner: { tool: "rail", session_id: SID, since: "2026-10-03T00:00:05.000Z" },
        receipt: { panesRemaining: 0, panesTotal: 0, unitsDone: 3, unitsFailed: 0, status: "done", finished: "2026-10-03T00:00:09.000Z" },
        dag: { project: "p-webt2", project_name: "steps-webt", dag_id: "child", content_hash: "hashc", source: goneSource },
      },
      null,
      2,
    ),
  )
  mkdirSync(join(root, "sessions", CSID), { recursive: true })
  writeFileSync(
    join(root, "sessions", CSID, "session.json"),
    JSON.stringify({ id: CSID, created: "2026-10-03T00:00:05.000Z", cwd: "/tmp" }),
  )

  // the happy parent: w1 done, the wake levied + finished by the
  // child's receipt, the trailing check passed
  writeJob(root, {
    sid: SID,
    jid: "j-par01",
    created: "2026-10-03T00:00:20.000Z",
    wakes: {
      sub: {
        jid: "j-chi01",
        jobDir: childRun,
        folder: join(root, "program", "child"),
        leviedAt: "2026-10-03T00:00:06.000Z",
      },
    },
    settled: { done: ["a", "b", "sub", "audit"], failed: [] },
  }, { dagSource: goneSource })

  // the failed parent: b failed in w1 -> the wake is unreachable and
  // was never levied (no booking), the check cannot be asked
  writeJob(root, {
    sid: SID,
    jid: "j-par02",
    created: "2026-10-02T00:00:00.000Z",
    wakes: null,
    settled: { done: ["a"], failed: ["b"] },
  }, { dagSource: goneSource })

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

type ShapeNode = {
  id: string
  finished_by?: string
  wave?: string
  child?: {
    levied: boolean
    jid?: string
    sid?: string
    state?: string
    status?: string
    outcome?: string | null
    dag?: string | null
    steps?: { id: string; finished_by: string }[]
    states?: { done: string[]; failed: string[] }
    reason?: string
  }
}

test("steps shape carries chain edges, finish states, and the wake's child program", async (t) => {
  const goneSource = join(tmpdir(), "aos-steps-gone-" + Date.now())
  const root = fixtureRoot(goneSource)
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

  // the happy run's shape: the whole declared topology in one payload
  const res = await fetch(`http://127.0.0.1:${port}/api/dag-shape/${SID}/j-par01`)
  assert.equal(res.status, 200)
  const shape = (await res.json()) as {
    kind: string
    nodes: ShapeNode[]
    edges: { from: string; to: string }[]
    states: { done: string[]; failed: string[] }
  }
  assert.equal(shape.kind, "steps")

  // chain edges: the wave-to-wave fan (a→sub, b→sub, sub→audit)
  const keys = shape.edges.map((e) => `${e.from}->${e.to}`).sort()
  assert.deepEqual(keys, ["a->sub", "b->sub", "sub->audit"])

  // finish states ride the shape (the edge-coloring data)
  assert.deepEqual(shape.states.done.sort(), ["a", "audit", "b", "sub"])
  assert.deepEqual(shape.states.failed, [])

  // nodes carry their wave (the layout's levels)
  const sub = shape.nodes.find((n) => n.id === "sub")
  assert.ok(sub, "the wake step is a node")
  assert.equal(sub.wave, "w2")

  // the wake step carries its CHILD: the booking resolves to the child
  // job record, the receipt outcome, and the child's own steps
  const c = sub.child
  assert.ok(c, "the wake node carries a child block")
  assert.equal(c.levied, true)
  assert.equal(c.jid, "j-chi01")
  assert.equal(c.sid, CSID)
  assert.equal(c.state, "retired")
  assert.equal(c.status, "success")
  assert.equal(c.outcome, "done")
  assert.equal(c.dag, "p-webt2/child")
  assert.deepEqual(
    (c.steps ?? []).map((s) => `${s.id}:${s.finished_by}`),
    ["x:end", "y:end", "z:check"],
  )
  assert.deepEqual(c.states?.done.sort(), ["x", "y", "z"])

  // the failed run: b failed -> the wake is hollow with the reason,
  // and its edges would read danger (failed upstream in states)
  const res2 = await fetch(`http://127.0.0.1:${port}/api/dag-shape/${SID}/j-par02`)
  assert.equal(res2.status, 200)
  const shape2 = (await res2.json()) as {
    nodes: ShapeNode[]
    states: { done: string[]; failed: string[] }
  }
  assert.deepEqual(shape2.states.failed, ["b"])
  const sub2 = shape2.nodes.find((n) => n.id === "sub")
  assert.ok(sub2?.child)
  assert.equal(sub2.child.levied, false)
  assert.match(sub2.child.reason ?? "", /unreachable/)
})

test("dag-definition fallback serves the staged steps with the wake child intact", async (t) => {
  const goneSource = join(tmpdir(), "aos-steps-gone2-" + Date.now())
  const root = fixtureRoot(goneSource)
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

  // source dangles -> the NEWEST staged copy serves the definition
  // (j-par01 is newer), marked stale, wake child riding the node
  const res = await fetch(`http://127.0.0.1:${port}/api/dag-definition/p-webt2/stepsdemo`)
  assert.equal(res.status, 200)
  const def = (await res.json()) as {
    kind: string
    stale?: { fromRun: string }
    nodes: ShapeNode[]
    edges: { from: string; to: string }[]
  }
  assert.equal(def.kind, "steps")
  assert.ok(def.stale, "the fallback is marked stale")
  assert.equal(def.stale.fromRun, "j-par01")
  assert.deepEqual(
    def.edges.map((e) => `${e.from}->${e.to}`).sort(),
    ["a->sub", "b->sub", "sub->audit"],
  )
  const sub = def.nodes.find((n) => n.id === "sub")
  assert.ok(sub?.child?.levied, "the staged copy's wake carries its child")
  assert.equal(sub.child.jid, "j-chi01")
  assert.deepEqual(
    (sub.child.steps ?? []).map((s) => s.id),
    ["x", "y", "z"],
  )
})
