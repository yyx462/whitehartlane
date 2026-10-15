// ADR 0010 — the herdr brownout guard: births stagger into a queue,
// refused starts knock again with growing pauses, the fork rung
// retries a brown herdr, and the doorbell is named in the audit —
// never silent, never dead on first refusal (the 2026-10-12 09:51
// storm).
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { backoffBase, backoffMs, drawJitter, retries, sleepSync } from "../src/backoff.ts"
import { createJob, wakeAudit, wakeFirstMate, type JobRecord } from "../src/store.ts"
import { fakeHerdr, fakeRail, type FakeHerdr } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-brown-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

test("backoff primitives: env wins, test context collapses, pauses grow", () => {
  // under node:test the defaults collapse — the suite never sleeps
  assert.equal(retries("AGENTIC_OS_BROWN_X_TRIES", 3), 1)
  assert.equal(backoffBase("AGENTIC_OS_BROWN_X_MS", 5_000), 0)
  assert.equal(drawJitter(1_500) <= 1_500, true)
  assert.equal(drawJitter(0), 0)
  // an explicit env knob always wins
  process.env.AGENTIC_OS_BROWN_X_TRIES = "5"
  process.env.AGENTIC_OS_BROWN_X_MS = "250"
  assert.equal(retries("AGENTIC_OS_BROWN_X_TRIES", 3), 5)
  assert.equal(backoffBase("AGENTIC_OS_BROWN_X_MS", 5_000), 250)
  delete process.env.AGENTIC_OS_BROWN_X_TRIES
  delete process.env.AGENTIC_OS_BROWN_X_MS
  // knock louder each time: base, ×3, ×9
  assert.equal(backoffMs(1_000, 1), 1_000)
  assert.equal(backoffMs(1_000, 2), 3_000)
  assert.equal(backoffMs(1_000, 3), 9_000)
  // the sync sleep is bounded by its argument — 0 returns immediately
  const t0 = Date.now()
  sleepSync(0)
  assert.ok(Date.now() - t0 < 50)
})

test("a refused agent start knocks again — the third attempt births the pane", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-brown-rail-"))
  writeFileSync(join(dir, "brief.md"), "do the thing\n")
  const base = fakeHerdr()
  let starts = 0
  const herdr: FakeHerdr = {
    ...base,
    runner: (args) => {
      if (args[0] === "agent" && args[1] === "start") {
        starts += 1
        if (starts <= 2) return { status: 1, stdout: "" } // herdr is brown, twice
      }
      return base.runner(args)
    },
  }
  const logs: string[] = []
  const rail = fakeRail(dir, herdr, null, { log: (m) => logs.push(m) })
  process.env.AGENTIC_OS_START_TRIES = "3"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "1"
  process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
  try {
    const ok = rail.inhabitPane("w1", "opencode", "p-1", join(dir, "brief.md"), dir, undefined, undefined, true)
    assert.equal(ok, true, "the pane is born on the retrying third attempt")
    assert.equal(starts, 3)
    assert.ok(logs.some((l) => l.includes("attempt 1/3")), "each refusal is logged with its attempt count")
    assert.ok(logs.some((l) => l.includes("herdr brownout guard")), "the retry names its reason")
  } finally {
    delete process.env.AGENTIC_OS_START_TRIES
    delete process.env.AGENTIC_OS_START_BACKOFF_MS
    delete process.env.AGENTIC_OS_BIRTH_JITTER_MS
  }
})

test("an always-brown herdr exhausts its attempts and clears the ghost — not death on first refusal", () => {
  const dir = mkdtempSync(join(tmpdir(), "aos-brown-dead-"))
  writeFileSync(join(dir, "brief.md"), "do the thing\n")
  const base = fakeHerdr()
  let starts = 0
  const herdr: FakeHerdr = {
    ...base,
    runner: (args) => {
      if (args[0] === "agent" && args[1] === "start") {
        starts += 1
        return { status: 1, stdout: "" } // brown forever
      }
      return base.runner(args)
    },
  }
  const logs: string[] = []
  const rail = fakeRail(dir, herdr, null, { log: (m) => logs.push(m) })
  process.env.AGENTIC_OS_START_TRIES = "2"
  process.env.AGENTIC_OS_START_BACKOFF_MS = "1"
  try {
    const ok = rail.inhabitPane("w1", "opencode", "p-1", join(dir, "brief.md"), dir, undefined, undefined, true)
    assert.equal(ok, false)
    assert.equal(starts, 2, "exactly the budgeted attempts — no infinite knocking")
    assert.ok(logs.some((l) => l.includes("after 2 attempt(s) — ghost cleared")), "the final refusal says so")
  } finally {
    delete process.env.AGENTIC_OS_START_TRIES
    delete process.env.AGENTIC_OS_START_BACKOFF_MS
  }
})

const SPAWNER = { tool: "opencode", session_id: "ses_brown", since: "2026-10-12T00:00:00.000Z" }

function levied(sid: string, task: string): JobRecord {
  return createJob({ sid, stoodUpBy: "levy", workflow: "fan-out", task, runDir: true, spawner: SPAWNER })
}

test("the fork rung retries a brown herdr — second knock rebirths the levy", () => {
  process.env.AGENTIC_OS_FORK_TRIES = "2"
  process.env.AGENTIC_OS_FORK_BACKOFF_MS = "1"
  try {
    const job = levied("s-brown1", "retry the fork")
    let knocks = 0
    wakeFirstMate(job, "failed", null, {
      promptPane: () => false,
      forkLevy: () => {
        knocks += 1
        return knocks >= 2 ? { ok: true, label: "fork-x", pane: "wF:p1" } : { ok: false, why: "herdr brownout" }
      },
      notify: () => {},
    })
    assert.equal(knocks, 2, "the brown first knock was retried, not accepted")
    assert.equal(job.woke?.delivery, "fork")
    assert.ok(
      job.woke?.rungs?.some((r) => r.rung === "fork" && /brownout retry 1\/1/.test(r.why ?? "")),
      "the retry lands in the rung trace",
    )
  } finally {
    delete process.env.AGENTIC_OS_FORK_TRIES
    delete process.env.AGENTIC_OS_FORK_BACKOFF_MS
  }
})

test("an exhausted fork falls to the doorbell with its diagnosis — and the audit names it", () => {
  process.env.AGENTIC_OS_FORK_TRIES = "2"
  process.env.AGENTIC_OS_FORK_BACKOFF_MS = "1"
  try {
    const job = levied("s-brown2", "exhaust the fork")
    let knocks = 0
    const doorbell: string[] = []
    wakeFirstMate(job, "failed", null, {
      promptPane: () => false,
      forkLevy: () => {
        knocks += 1
        return { ok: false, why: "herdr down" }
      },
      notify: (m) => doorbell.push(m),
    })
    assert.equal(knocks, 2)
    assert.equal(job.woke?.delivery, "doorbell")
    assert.ok(job.woke?.rungs?.some((r) => r.rung === "fork" && /fork refused: herdr down/.test(r.why ?? "")))

    // the audit: out-of-band and unconsumed wakes are named with the
    // fork's final diagnosis; consumed (fork) and unwoken jobs are not
    const healthy = levied("s-brown3", "fork took it")
    wakeFirstMate(healthy, "done", null, {
      promptPane: () => false,
      forkLevy: () => ({ ok: true, label: "fork-y", pane: "wF:p2" }),
      notify: () => {},
    })
    const unwoken = levied("s-brown4", "never woke")
    const listed = wakeAudit([job, healthy, unwoken])
    assert.deepEqual(listed.map((r) => r.jid), [job.id], "only the doorbelled, unconsumed wake is listed")
    assert.equal(listed[0]!.delivery, "doorbell")
    assert.match(listed[0]!.why, /herdr down/, "the diagnosis is the fork's final refusal")
  } finally {
    delete process.env.AGENTIC_OS_FORK_TRIES
    delete process.env.AGENTIC_OS_FORK_BACKOFF_MS
  }
})

test("a fork-delivered wake whose courier never worked is audited for a re-drain (issue #124)", () => {
  const silent = levied("s-brown5", "courier never worked")
  wakeFirstMate(silent, "aborted", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: true, label: "fork-silent", pane: "wF:p9" }),
    notify: () => {},
  })
  assert.equal(silent.woke?.delivery, "fork")
  assert.ok(silent.consumed, "consumed was booked on courier birth — the false ack j-64e035 lived with")
  // the reaper's honest receipt: the pane closed before any live turn
  writeFileSync(join(silent.dir, "courier.json"), '{"worked":false}')

  const delivered = levied("s-brown6", "courier worked")
  wakeFirstMate(delivered, "done", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: true, label: "fork-live", pane: "wF:p8" }),
    notify: () => {},
  })
  writeFileSync(join(delivered.dir, "courier.json"), '{"worked":true}')

  const noReceipt = levied("s-brown7", "pre-fix run, no receipt")
  wakeFirstMate(noReceipt, "done", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: true, label: "fork-old", pane: "wF:p7" }),
    notify: () => {},
  })

  const listed = wakeAudit([silent, delivered, noReceipt])
  assert.deepEqual(listed.map((r) => r.jid), [silent.id], "only the never-worked courier is listed")
  assert.equal(listed[0]!.delivery, "fork")
  assert.match(listed[0]!.why, /never reached a live turn/)
})
