// v5.2 — the dangling-source read-only fallback, proved against a
// fixture OS disk: a spur whose source folder is GONE still serves its
// definition from the newest run's staged copy (marked stale), Trigger
// keeps refusing, and NOTHING on disk changes (the fallback is a
// display, never a write — this is the safety net for the parked
// "delete dangling runs" discussion; see
// docs/research/dangling-source-pointers.md).
// ADR 0009: the fixture records here are deliberately OLD-spelled
// (`dag` block, `dag_id` key) — records written before the rename
// must keep rendering (the server reads both spellings, always).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"

const SID = "s-webt01"

type StagedRun = {
  jid: string
  created: string
  members: Record<string, string>
}

function fixtureRoot(runs: StagedRun[], goneSource: string): string {
  const root = mkdtempSync(join(tmpdir(), "aos-web-fb-"))
  for (const r of runs) {
    const runDir = join(root, "sessions", SID, "jobs", r.jid, "run")
    mkdirSync(join(runDir, "members"), { recursive: true })
    for (const [name, text] of Object.entries(r.members)) {
      writeFileSync(join(runDir, "members", `${name}.md`), text)
    }
    writeFileSync(
      join(runDir, "workflow.toml"),
      '[workflow]\nname = "fb"\ndag_id = "fb"\nkind = "coworker"\n\n[hooks]\nunits = "true"\n',
    )
    writeFileSync(
      join(root, "sessions", SID, "jobs", r.jid, "job.json"),
      JSON.stringify({
        id: r.jid,
        sid: SID,
        state: "retired",
        created: r.created,
        dir: runDir,
        workflow: "coworker",
        panes: [],
        dag: {
          project: "p-webt",
          project_name: "fb-fixture",
          dag_id: "fb",
          content_hash: "hash1",
          source: goneSource,
        },
      }),
    )
  }
  return root
}

function diskSnapshot(root: string): string {
  const lines: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const st = statSync(p)
        lines.push(`${p.replace(root, "")}|${st.size}|${st.mtimeMs}`)
      }
    }
  }
  walk(root)
  return lines.sort().join("\n")
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

test("a gone-source spur's definition falls back read-only to the newest staged copy (old dag_id records still render)", async (t) => {
  const goneSource = join(tmpdir(), "aos-definitely-gone-" + Date.now())
  const root = fixtureRoot(
    [
      {
        jid: "j-old01",
        created: "2026-10-01T00:00:00.000Z",
        members: { solo: "You are solo — the older staged copy." },
      },
      {
        jid: "j-new01",
        created: "2026-10-02T00:00:00.000Z",
        members: {
          backend: "You are backend — the senior member of the staged copy.\n\nThe world (task.txt is the source of truth):\n- the source worktree is gone; this copy is what remains.\n",
          frontend: "You are frontend — the staged copy member.\n\nBuild the pages from the staged brief only.\n",
        },
      },
    ],
    goneSource,
  )
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
  // the mutation bearer the server minted into the fixture root
  const token = readFileSync(join(root, "window.token"), "utf8").trim()

  const before = diskSnapshot(root)

  // the fallback: 200 with the NEWEST staged copy, marked stale
  const defRes = await fetch(`http://127.0.0.1:${port}/api/dag-definition/p-webt/fb`)
  assert.equal(defRes.status, 200)
  const def = (await defRes.json()) as {
    kind: string
    stale?: { fromRun: string; fromSid: string; reason: string }
    nodes: { id: string; does: string; brief: string | null }[]
    hooks: { section: string; name: string }[]
  }
  assert.equal(def.kind, "coworker")
  assert.ok(def.stale, "the fallback must be marked stale")
  assert.equal(def.stale?.fromRun, "j-new01", "newest staged run wins")
  assert.equal(def.stale?.fromSid, SID)
  assert.match(def.stale?.reason ?? "", /folder does not exist/)
  assert.deepEqual(
    def.nodes.map((n) => n.id).sort(),
    ["backend", "frontend"],
  )
  assert.equal(def.nodes[0].does, "You are backend — the senior member of the staged copy.")
  assert.ok(def.nodes[0].brief && def.nodes[0].brief.length > def.nodes[0].does.length, "full brief travels with the node")
  assert.deepEqual(def.hooks.map((h) => h.name), ["units"])

  // trigger keeps refusing — the source is the thing that runs
  const trigRes = await fetch(`http://127.0.0.1:${port}/api/dags/p-webt/fb/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(trigRes.status, 400)
  const trigBody = (await trigRes.json()) as { error?: string }
  assert.match(trigBody.error ?? "", /folder does not exist/)

  // program listing shows nothing editable, and a write into the gone
  // source refuses — the fallback is a display, never an edit target
  const progRes = await fetch(`http://127.0.0.1:${port}/api/program?dag=p-webt%2Ffb`)
  assert.equal(progRes.status, 200)
  const progBody = (await progRes.json()) as { files: unknown[] }
  assert.deepEqual(progBody.files, [])
  const putRes = await fetch(`http://127.0.0.1:${port}/api/program`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ dag: "p-webt/fb", name: "workflow.toml", text: "x" }),
  })
  assert.equal(putRes.status, 400)

  // display-only, proved: not one byte of the OS disk moved
  assert.equal(diskSnapshot(root), before)
})
