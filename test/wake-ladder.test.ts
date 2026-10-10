// v9 — ADR 0008 ladder, full order: worker pane → registered levy
// pane → fork → spool → doorbell → queued. Registration is the only
// aliveness claim that outranks the fork (a fresh spool heartbeat
// does NOT); an unregistered chat is dead to the ladder by rule and
// is rebirthed into a pane; the spool is opt-in plugin territory,
// reached only when the fork could not take the wake.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { levyPaneOf, registerLevyPane } from "../src/levy-pane.ts"
import { createJob, readEvents, wakeFirstMate } from "../src/store.ts"

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

test("rung 2 — a registered live levy pane takes the wake in-band, tool-independent", () => {
  registerLevyPane({ session_id: SPAWNER.session_id, tool: "opencode", pane: "wL:p9", at: new Date().toISOString() })
  const job = levied("s-lad2")
  const prompts: string[] = []
  const forked: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: (_label, text) => { prompts.push(text); return true },
    paneAlive: () => true,
    forkLevy: () => { forked.push("must not run"); return { ok: true, label: "no" } },
  })
  assert.equal(job.woke?.delivery, "pane")
  assert.equal(job.woke?.to, "wL:p9", "the registered pane is the address")
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /\[wake\] spur for task "ladder probe" done/)
  assert.equal(forked.length, 0, "registration outranks the fork")
})

test("a registered pane that died no longer claims — the fork takes it", () => {
  const job = levied("s-lad3")
  const forked: string[] = []
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    paneAlive: () => false,
    forkLevy: (j) => { forked.push(j.id); return { ok: true, label: `fork-${j.id}`, pane: "wF:p1" } },
  })
  assert.equal(job.woke?.delivery, "fork")
  assert.equal(job.woke?.to, `fork-${job.id}`)
  assert.equal(job.consumed?.via, "fork", "the rebirth books the consumption")
  assert.ok(readEvents("s-lad3").some((e) => e.kind === "wake.consumed" && e.via === "fork"))
})

test("an unregistered chat is dead to the ladder — the fork rebirths it (the rule)", () => {
  rmSync(join(HOME, "levy-panes", `${SPAWNER.session_id}.json`), { force: true })
  const job = levied("s-lad4")
  let spoolQuestioned = false
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    paneAlive: () => { spoolQuestioned = true; return false },
    forkLevy: () => ({ ok: true, label: "fork-reborn", pane: "wF:p2" }),
  })
  assert.equal(job.woke?.delivery, "fork")
  assert.equal(spoolQuestioned, false, "no registration on file — the pane oracle is not even consulted")
})

test("when the fork cannot take it, a fresh spool heartbeat still can (opt-in plugin)", () => {
  const job = levied("s-lad5")
  mkdirSync(join(HOME, "wake-spool", SPAWNER.session_id), { recursive: true })
  writeFileSync(join(HOME, "wake-spool", SPAWNER.session_id, "alive.json"), JSON.stringify({ pid: 1, at: Date.now() }))
  wakeFirstMate(job, "done", null, {
    promptPane: () => false,
    forkLevy: () => ({ ok: false, why: "herdr down" }),
  })
  assert.equal(job.woke?.delivery, "inband")
  const q = readFileSync(join(HOME, "wake-spool", SPAWNER.session_id, "queue.jsonl"), "utf8")
  assert.match(q, /ladder probe/)
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
