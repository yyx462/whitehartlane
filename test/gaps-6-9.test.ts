// gaps-6-9.test.ts — #201 rows 8 and 9: the edited-declaration note on
// continue, and the projection-recovery verb that was advertised but
// never wired.
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import assert from "node:assert/strict"

process.env.AGENTIC_OS_HOME ??= mkdtempSync(join(tmpdir(), "whl-gaps69-"))
process.env.AGENTIC_OS_NOTIFY = "0"

const bin = join(import.meta.dirname, "..", "bin", "whitehartlane")
const run = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", bin, ...args], {
  encoding: "utf8",
  env: { ...process.env, AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME },
  timeout: 60_000,
})

test("events --job <jid> --rebuild projects the record from the trace (#201 row 9)", async () => {
  const { createJob, appendEvent, saveJob, loadJob } = await import("../src/adapters/store.ts")
  const { openSession } = await import("../src/adapters/store.ts")
  const sess = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const job = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "rebuildable", runDir: true })
  appendEvent(sess.id, { actor: "orchestrator", kind: "job.retired", jid: job.id, receipt: { status: "done" } })
  // mangle the record — the projection must overwrite the mangling
  job.state = "garbage"
  saveJob(job)
  const out = run(["events", "--job", job.id, "--rebuild"])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /projected from \d+ trace event/)
  const healed = loadJob(sess.id, job.id)
  assert.ok(healed)
  assert.notEqual(healed.state, "garbage", "the record was rebuilt from the trace")
})

test("continue announces an edited program — event + note, never silent (#201 row 8)", async () => {
  const { createJob, saveJob, listJobs, readEvents } = await import("../src/adapters/store.ts")
  const { openSession } = await import("../src/adapters/store.ts")
  const sess = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const src = mkdtempSync(join(tmpdir(), "whl-edited-"))
  writeFileSync(join(src, "workflow.toml"), "[workflow]\nname = \"edited\"\n")
  const job = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "edited", runDir: true })
  job.state = "aborted"
  job.spur = { project: "p", project_name: "p", spur_id: "edited", content_hash: "stale-hash", source: src, labels: {} }
  saveJob(job)
  // the source changed after booking (hash differs)
  const out = run(["continue", job.id])
  // the rebirth may fail (no orchestrator on this isolated disk) — the
  // NOTE rides BEFORE it, on stdout
  assert.match(out.stdout, /changed since booking; this rebirth runs the EDITED program/)
  const evts = readEvents(sess.id).filter((e) => e.kind === "program.changed" && e.jid === job.id)
  assert.equal(evts.length, 1, "the edited declaration is booked on the trace")
  void listJobs
})
