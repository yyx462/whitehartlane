// ADR 0006 — the end-of-job wake, proved on a fixture OS disk:
// a Job with a spawner wakes the levy exactly once (wake.json +
// job.woke on the trace + the once-guard); a Job without a spawner
// never wakes; the doorbell is disabled here (AGENTIC_OS_NOTIFY=0).
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  abortJob,
  createJob,
  finishJob,
  readEvents,
} from "../src/store.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-wake-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function jobWith(spawner?: { tool: string; session_id: string; since: string }) {
  return createJob({
    sid: "s-wake01",
    stoodUpBy: spawner ? "levy" : "standalone",
    workflow: "fan-out",
    task: "prove the wake",
    runDir: true,
    ...(spawner ? { spawner } : {}),
  })
}

test("retire wakes the spawning levy exactly once", () => {
  const job = jobWith({ tool: "opencode", session_id: "ses_01abc", since: "2026-10-09T00:00:00.000Z" })
  finishJob(job, { panesRemaining: 0, panesTotal: 0, unitsDone: 1, unitsFailed: 0, status: "done", report: join(job.dir, "report.json") })

  const wake = JSON.parse(readFileSync(join(job.dir, "wake.json"), "utf8"))
  assert.equal(wake.to.session_id, "ses_01abc")
  assert.match(wake.message, /spur for task "prove the wake" done/)
  assert.match(wake.message, /report\.json/)

  const events = readEvents("s-wake01") ?? []
  const woke = events.filter((e) => e.kind === "job.woke")
  assert.equal(woke.length, 1)
  assert.equal(woke[0].actor, "rail")
  assert.equal(woke[0].jid, job.id)
  assert.ok(job.woke, "the once-guard is booked on the record")

  // a second finish (replay, bug, whatever) must not wake again
  finishJob(job, { panesRemaining: 0, panesTotal: 0, unitsDone: 1, unitsFailed: 0, status: "done", report: join(job.dir, "report.json") })
  assert.equal((readEvents("s-wake01") ?? []).filter((e) => e.kind === "job.woke").length, 1)
})

test("a failed receipt wakes as failed — the levy must never read the all-clear", () => {
  const job = jobWith({ tool: "opencode", session_id: "ses_02bad", since: "2026-10-09T00:00:00.000Z" })
  finishJob(job, { panesRemaining: 0, panesTotal: 2, unitsDone: 0, unitsFailed: 2, status: "failed", report: join(job.dir, "report.json") })
  const wake = JSON.parse(readFileSync(join(job.dir, "wake.json"), "utf8"))
  assert.match(wake.message, /spur for task "prove the wake" failed/)
  assert.doesNotMatch(wake.message, /done/)
})

test("abort and orphan wake too; no spawner means no wake", () => {
  const gone = jobWith({ tool: "opencode", session_id: "ses_gone", since: "2026-10-09T00:00:00.000Z" })
  abortJob(gone, "killed pid 1", 2, "levy")
  assert.ok(existsSync(join(gone.dir, "wake.json")))
  assert.match(gone.woke!.message, /aborted \(killed pid 1\)/)

  const quiet = jobWith()
  abortJob(quiet, "declined by user", 0, "first_mate") // legacy wire value still accepted
  assert.ok(!quiet.woke, "unattended Jobs never wake")
  assert.ok(!existsSync(join(quiet.dir, "wake.json")))
})
