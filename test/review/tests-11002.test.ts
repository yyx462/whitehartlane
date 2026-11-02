// test/review/tests-11002.test.ts
//
// The #266 marker must ride the FIRST USER MESSAGE of every pane the
// engines birth — the lab's ACTOR included.
//
// This diff is the actor's half of that law: src/core/roles.ts:19-28
// gives actorBrief a marker line ("Your brief for this experiment is
// filed at <taskDir>/briefs/actor.md") and src/engines/lab.ts:134-135
// writes that brief and hands it to the actor's pane. The resolver
// (src/adapters/transcripts.ts:151-164) matches the marker against the
// first user message, and the seat's marker is dirname(briefPath) =
// <taskDir>/briefs (src/adapters/rail.ts:701).
//
// The twin left wrong: the brief reaches the actor INSIDE
// rail.inhabitPane -> host.inhabit, and that submission can FAIL —
// src/adapters/opencode-host.ts:134-140 logs "brief submission failed
// for <label>" and STILL returns true, so the lab cannot tell. The
// lab has no grace seat that re-briefs (the fan-out twin has one,
// src/engines/orchestrator.ts:843-852), so the actor is left with NO
// brief at all: its first user message is never its brief, the marker
// never rides it, the actor's session never books — and a continued
// lab re-briefs a fresh actor instead of resuming the booked one (the
// exact symptom src/core/roles.ts:11-16 says this diff fixes).
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLab } from "../../src/engines/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

// a scratch drive must never book a real workflow (the leaked-lens receipt)
const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("the lab actor whose BRIEF submission fails still gets a first user message with the booking marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tests-actor-birth-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "lab"',
      "",
      "[workflow]",
      'name = "tests-actor-birth"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")
  // the experiment ends at once — the actor never names a wave
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))

  // hermetic against the machine's real opencode store (gate-r27)
  const storeDb = join(dir, "store.db")
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(storeDb)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.close()
  const prevDb = process.env.OPENCODE_DB
  process.env.OPENCODE_DB = storeDb
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  process.env.AGENTIC_OS_ORCHESTRATOR = ORCH
  try {
    const herdr = fakeHerdr()
    const inner = herdr.runner
    // the BIRTH brief submission to the actor fails — the pane is not
    // ready yet (opencode-host.ts:137 logs it and still returns true)
    let refused = false
    herdr.runner = (args: string[]) => {
      if (args[0] === "agent" && args[1] === "prompt" && String(args[2]).includes("actor") && !refused) {
        refused = true
        return { status: 1, stdout: "" }
      }
      return inner(args)
    }
    const ledger = fakeLedger()
    const rail = fakeRail(dir, herdr, ledger as never)
    const actorTexts: string[] = []
    herdr.onPrompt = (name, text) => {
      if (name.includes("actor")) actorTexts.push(text)
    }
    const report = await runLab(rail)

    const marker = join(dir, "briefs")
    assert.ok(
      actorTexts.length > 0,
      `the actor must have received a first user message at all — it received none (its brief submission failed at birth and nothing re-sent it), so the booking marker ${marker} never rides its first user message and the actor's session can never book (the run reports ${JSON.stringify(report?.status ?? null)} with ${JSON.stringify(report?.table ?? null)})`,
    )
    const first = actorTexts[0]!
    assert.ok(
      first.includes(marker),
      `the actor's FIRST user message must carry the booking marker ${marker} — it received ${JSON.stringify(first.slice(0, 220))}`,
    )
  } finally {
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
