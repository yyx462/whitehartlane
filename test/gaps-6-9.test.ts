// gaps-6-9.test.ts — #201 rows 8 and 9: the edited-declaration note on
// continue, and the projection-recovery verb that was advertised but
// never wired.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
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

test("continue announces an edited program — event + note, never silent (#201 row 8, photo-based since #296)", async () => {
  const { saveJob, readEvents } = await import("../src/adapters/store.ts")
  const { prepareRun } = await import("../src/doors/run.ts")
  // a real booking: staging writes the .whl-program photo the compare reads
  const prog = mkdtempSync(join(tmpdir(), "whl-edited-"))
  mkdirSync(join(prog, "hooks"), { recursive: true })
  writeFileSync(join(prog, "workflow.toml"), "[workflow]\nname='edited'\nworker_kind='pi'\n[[stage]]\nid=\"s1\"\ntopology=\"gate\"\nrun=\"bash hooks/x.sh\"\n")
  writeFileSync(join(prog, "contract.toml"), "[[contract.deliverables]]\nname=\"out\"\npath=\"out.md\"\nkind=\"file\"\n")
  writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 0\n")
  const ready = prepareRun(prog)
  assert.ok(ready.ok, `the program must book: ${ready.ok ? "" : ready.why}`)
  const job = ready.job
  job.state = "aborted"
  saveJob(job)
  // the source changed after booking: a BOOKED PAGE edited (#296: a
  // dropped NEW file must not fire this — the photo has no page for it)
  writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 1\n")
  const out = run(["continue", job.id])
  // the rebirth may fail (no orchestrator on this isolated disk) — the
  // NOTE rides BEFORE it, on stdout
  assert.match(out.stdout, /changed since booking; this rebirth runs the EDITED program/)
  const evts = readEvents(job.sid).filter((e) => e.kind === "program.changed" && e.jid === job.id)
  assert.equal(evts.length, 1, "the edited declaration is booked on the trace")
})
