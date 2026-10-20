// v10 — ADR 0008 ladder, simplified (2026-10-13): parent pane → fork →
// spool (config-off) → doorbell → queued. The worker-pane scan and the
// manual registry rungs are RETIRED — the spawn-time parent pane does
// their one job; the registry survives only as audit bookkeeping, and
// these tests pin that the wake truly no longer consults it.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { levyPaneOf, registerLevyPane } from "../src/adapters/levy-pane.ts"
import { createJob, readEvents, wakeFirstMate } from "../src/adapters/store.ts"

const HOME = mkdtempSync(join(tmpdir(), "aos-ladder-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(HOME, { recursive: true, force: true }))

const SPAWNER = { tool: "opencode", session_id: "ses_ladder", since: "2026-10-11T00:00:00.000Z" }

function levied(sid = "s-lad") {
  return createJob({
    sid,
    stoodUpBy: "levy",
    workflow: "coworker",
    task: "ladder probe",
    runDir: true,
    spawner: SPAWNER,
  })
}

test("the registry: register, look up by session, look up by pane", () => {
  registerLevyPane({ session_id: "ses_x", tool: "opencode", pane: "wZ:p1", at: "t" })
  assert.equal(levyPaneOf("ses_x")?.pane, "wZ:p1")
  rmSync(join(HOME, "levy-panes"), { recursive: true, force: true })
})

test("the registry is retired as a wake rung — a registered live pane is never prompted", () => {
  registerLevyPane({ session_id: SPAWNER.session_id, tool: "opencode", pane: "wL:p9", at: new Date().toISOString() })
  const job = levied("s-lad2")
  const prompts: string[] = []
  const forked: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: (_label, text) => { prompts.push(text); return true },
    forkLevy: () => { forked.push("takes it"); return { ok: true, label: "fork-x", pane: "wF:p1" } },
  })
  assert.deepEqual(prompts, [], "a registry entry is not a wake address anymore")
  assert.equal(job.woke?.delivery, "fork")
  assert.equal(forked.length, 1, "the fork takes what the registry used to")
  assert.ok(levyPaneOf(SPAWNER.session_id) !== null, "the registry record itself survives (audit bookkeeping)")
})

test("a registered pane that died no longer claims — the fork takes it", () => {
  const job = levied("s-lad3")
  const forked: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    forkLevy: (j) => { forked.push(j.id); return { ok: true, label: `fork-${j.id}`, pane: "wF:p1" } },
  })
  assert.equal(job.woke?.delivery, "fork")
  assert.equal(job.woke?.to, `fork-${job.id}`)
  assert.equal(job.consumed?.via, "fork", "the rebirth books the consumption")
  assert.ok(readEvents("s-lad3").some((e) => e.kind === "wake.consumed" && e.via === "fork"))
})

test("a levy without a booked pane is forked — the rule", () => {
  rmSync(join(HOME, "levy-panes", `${SPAWNER.session_id}.json`), { force: true })
  const job = levied("s-lad4")
  const prompts: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: (label) => { prompts.push(label); return false },
    forkLevy: () => ({ ok: true, label: "fork-reborn", pane: "wF:p2" }),
  })
  assert.equal(job.woke?.delivery, "fork")
  assert.deepEqual(prompts, [], "nothing to prompt — no pane was booked at spawn")
})

test("a fresh spool heartbeat outranks the fork — a listening levy never pays for a rebirth tab", () => {
  const prev = process.env.AGENTIC_OS_SPOOL_WAKE
  process.env.AGENTIC_OS_SPOOL_WAKE = "1"
  try {
    const job = levied("s-lad5")
    mkdirSync(join(HOME, "wake-spool", SPAWNER.session_id), { recursive: true })
    writeFileSync(join(HOME, "wake-spool", SPAWNER.session_id, "alive.json"), JSON.stringify({ pid: 1, at: Date.now() }))
    let forkTried = 0
    wakeFirstMate(job, "done", null, {
      promptPane: () => false,
      forkLevy: () => { forkTried++; return { ok: false, why: "herdr down" } },
    })
    assert.equal(job.woke?.delivery, "inband")
    assert.equal(forkTried, 0, "the fork rung never runs when the spool takes the wake")
    assert.equal(job.woke?.rungs?.some((r) => r.rung === "fork"), false, "no fork trace either — nothing opened")
    const q = readFileSync(join(HOME, "wake-spool", SPAWNER.session_id, "queue.jsonl"), "utf8")
    assert.match(q, /ladder probe/)
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_SPOOL_WAKE
    else process.env.AGENTIC_OS_SPOOL_WAKE = prev
  }
})

test("fork down and no listener: the doorbell, as ever", () => {
  rmSync(join(HOME, "wake-spool", SPAWNER.session_id), { recursive: true, force: true })
  const job = levied("s-lad6")
  const bells: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: false, why: "herdr down" }),
    notify: (t) => bells.push(t),
  })
  assert.equal(job.woke?.delivery, "doorbell")
  assert.equal(bells.length, 1)
})
