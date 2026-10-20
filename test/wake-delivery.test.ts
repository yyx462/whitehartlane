// ADR 0006 — wake delivery, proved on a fixture OS disk: the wake
// lands in-band when the PARENT PANE (booked on the spawner record at
// spawn) is live and titled like the session; job-booking discovery
// and the manual registry are retired (2026-10-13) — the pane booked
// at handover is the one address. The doorbell is the fallback when
// nothing takes it; the durable record waits (queued) when nothing
// can ring. Booked wait: the sessions running Jobs name as spawner.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  abortJob,
  attachPane,
  createJob,
  findLivePaneForSpawner,
  killPane,
  liveSpawnerSessionIds,
  readEvents,
  wakeFirstMate,
} from "../src/adapters/store.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-deliver-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const SPAWNER = { tool: "opencode", session_id: "ses_01abc", since: "2026-10-09T00:00:00.000Z" }

function parentWithPane(sessionId: string, label: string) {
  const job = createJob({
    sid: "s-parent",
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "parent work",
    runDir: true,
  })
  attachPane(job, {
    label,
    parent: "orchestrator",
    transcript: { tool: "opencode", cwd: "/tmp/parent", since: "2026-10-09T00:00:00.000Z", session_id: sessionId },
  })
  return job
}

test("job-booking discovery is retired — a booked worker pane no longer takes the wake", () => {
  parentWithPane("ses_01abc", "w-hold")
  const child = createJob({
    sid: "s-child1",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: SPAWNER,
  })
  const prompts: { label: string; text: string }[] = []
  const notifications: string[] = []

  wakeFirstMate(child, "done", null, {
    promptPane: (label, text) => {
      prompts.push({ label, text })
      return true
    },
    notify: (message) => notifications.push(message),
  })

  // the pane booked on the parent Job is not the spawner's booked pane:
  // the ladder never consults job bookings anymore — the spawn-time
  // parent pane is the one address (see wake-rung-trace.test.ts)
  assert.deepEqual(prompts, [], "no prompt left for a merely-booked pane")
  assert.equal(child.woke!.delivery, "doorbell")
  assert.equal(notifications.length, 1)
  const woke = readEvents("s-child1").filter((e) => e.kind === "job.woke")
  assert.equal(woke[0]!.delivery, "doorbell")
})

test("no live pane: the doorbell rings as the fallback", () => {
  const child = createJob({
    sid: "s-child2",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: { tool: "opencode", session_id: "ses_nobody", since: "2026-10-09T00:00:00.000Z" },
  })
  const notifications: string[] = []

  wakeFirstMate(child, "aborted (test)", null, {
    promptPane: () => true,
    notify: (message) => notifications.push(message),
  })

  assert.equal(child.woke!.delivery, "doorbell")
  assert.equal(notifications.length, 1)
  assert.match(notifications[0]!, /aborted \(test\)/)
})

test("a pane that cannot take the prompt falls back to the doorbell", () => {
  parentWithPane("ses_busy", "w-busy")
  const child = createJob({
    sid: "s-child3",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: { tool: "opencode", session_id: "ses_busy", since: "2026-10-09T00:00:00.000Z" },
  })
  const notifications: string[] = []

  wakeFirstMate(child, "done", null, {
    promptPane: () => false,
    notify: (message) => notifications.push(message),
  })

  assert.equal(child.woke!.delivery, "doorbell")
  assert.equal(notifications.length, 1)
})

test("nothing rings: the durable record waits (queued)", () => {
  const child = createJob({
    sid: "s-child4",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: { tool: "opencode", session_id: "ses_nobody", since: "2026-10-09T00:00:00.000Z" },
  })

  wakeFirstMate(child, "done", null, { promptPane: () => true })

  assert.equal(child.woke!.delivery, "queued")
})

test("booked wait: running Jobs hold their spawner sessions, parked ones do not", () => {
  const holder = parentWithPane("ses_wait", "w-wait")
  const child = createJob({
    sid: "s-child5",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: { tool: "opencode", session_id: "ses_wait", since: "2026-10-09T00:00:00.000Z" },
  })

  assert.ok(liveSpawnerSessionIds().has("ses_wait"))
  assert.equal(findLivePaneForSpawner("ses_wait", child.id)?.label, "w-wait")
  assert.equal(findLivePaneForSpawner("ses_wait", holder.id), null, "a Job never holds its own levy")

  abortJob(child, "test over", 0, "levy")
  assert.ok(!liveSpawnerSessionIds().has("ses_wait"), "a parked child no longer holds the pane")
})

test("a died pane record is not a live holder", () => {
  const parent = parentWithPane("ses_dying", "w-doomed")
  const child = createJob({
    sid: "s-child6",
    stoodUpBy: "levy",
    workflow: "fan-out",
    task: "child work",
    runDir: true,
    spawner: { tool: "opencode", session_id: "ses_dying", since: "2026-10-09T00:00:00.000Z" },
  })
  killPane(parent, "w-doomed")

  assert.equal(findLivePaneForSpawner("ses_dying", child.id), null)
})
