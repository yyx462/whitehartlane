// test/review/questions-41.test.ts
//
// THE BIRTH TWIN of the change's own fix.
//
// The change (src/engines/coworker-run.ts:711-727) closed ONE door of
// the decision "a first prompt that fails must retry WITH the brief":
// the relay path now stamps `prompted` only after the prompt SUCCEEDS.
//
// The other door is the BIRTH path, and it is open:
//
//  - at birth the host submits the member's brief and SWALLOWS a
//    refused submission (src/adapters/opencode-host.ts:135-139:
//    "brief submission failed for <label> — the grace reprompt will
//    retry"); inhabitPane still returns true,
//  - the coworker's bench has NO grace seat: rail.reprompt — the seat
//    that re-sends a brief (src/adapters/rail.ts:891-900) and the only
//    caller of which is the fan-out bench (src/engines/orchestrator.ts:
//    1064) — has no coworker caller at all,
//  - the engine then stamps `prompted` for a member whose prompt never
//    landed (src/engines/coworker-run.ts:239), so the member is
//    treated as briefed.
//
// Consequence: the member's FIRST user message is the stall nudge —
// no brief, no booking marker (<taskDir>/briefs), no session booking —
// the exact #266 death the change claims to close, surviving one path
// over (the repo's own law, AGENTS.md: "EVERY DOOR. One arm guarded
// and one open is a shipped bug, not a partial success").
//
// INV-4: an infra failure (a refused prompt) must never be recorded as
// an answer — "the member has its brief" is a fact the engine asserts
// to itself, and a refused birth prompt is not one.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runCoworker } from "../../src/engines/coworker-run.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

// a scratch drive must never book a real workflow (the leaked-lens receipt)
const ORCH = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("a member whose BIRTH prompt is refused still receives its brief (the booking marker rides its first user message)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "questions-birth-brief-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "questions-birth-brief"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
      "[members.alpha]",
      "initiates = true",
      "",
      "[members.beta]",
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "Find the capital and tell beta.\n")
  writeFileSync(join(dir, "members", "beta.md"), "Wait for alpha, then wrap up.\n")

  // hermetic against the machine's real opencode store (gate-r27):
  // the booking oracle reads the store, so point it at an empty temp db
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
    // the BIRTH prompt of alpha is REFUSED (the pane is still booting).
    // alpha initiates, so hold=false and its first user message IS its
    // brief. Every later prompt to alpha must succeed.
    const inner = herdr.runner
    let refused = false
    herdr.runner = (args: string[]) => {
      if (args[0] === "agent" && args[1] === "prompt" && String(args[2]).includes("alpha") && !refused) {
        refused = true
        return { status: 1, stdout: "" }
      }
      return inner(args)
    }
    const ledger = fakeLedger()
    const rail = fakeRail(dir, herdr, ledger as never)
    const alphaTexts: string[] = []
    herdr.onPrompt = (name, text) => {
      if (name.includes("alpha")) alphaTexts.push(text)
    }
    // alpha's mail is already in the box (the exchange must move so the
    // run ends); alpha itself never learns what to do — its brief is
    // what carries the task.
    mkdirSync(join(dir, "messages"), { recursive: true })
    writeFileSync(
      join(dir, "messages", "1-alpha.json"),
      JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
    )
    await runCoworker(rail, { stallMs: 60, beatMs: 10 })

    const marker = join(dir, "briefs")
    const brief = alphaTexts.find((t) => t.includes(marker))
    assert.ok(
      brief,
      `INV-4: alpha's BIRTH prompt was refused (infra) and the brief was never re-sent — ` +
        `the member's first user message carries no booking marker ${marker} ` +
        `(alpha received ${JSON.stringify(alphaTexts.slice(0, 2))}); ` +
        `a refused first prompt must be retried WITH the brief, or the member never books`,
    )
  } finally {
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
