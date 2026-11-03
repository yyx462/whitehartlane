// test/review/tests-11001.test.ts
//
// The #266 marker must ride the FIRST USER MESSAGE of every coworker
// member — on the RELAY path and on the BIRTH path alike.
//
// The diff closed the relay path (src/engines/coworker-run.ts:711-727:
// `prompted` now stamps only after a successful prompt, so a failed
// first relay retries WITH the brief). The BIRTH path is the twin that
// was left wrong:
//
//   src/engines/coworker-run.ts:239
//     if (ok && (m.initiates || resumeId)) prompted.add(m.name)
//
// `ok` is `rail.inhabitPane(...)`'s return value, and the BRIEF reaches
// the pane INSIDE that call (src/adapters/opencode-host.ts:134-140):
//
//     if (!spec.hold) {
//       const brief = readFileSync(spec.briefPath, "utf8")
//       const prompt = this.transport.exec("agent", "prompt", label, brief)
//       if (prompt.status !== 0) {
//         this.log(`brief submission failed for ${label} — the grace reprompt will retry`)
//       }
//     }
//     return true            // <-- the FAILED submission still returns true
//
// The host logs the failed submission and returns true anyway; the
// engine cannot see the difference, so the member is stamped
// "prompted" with NO brief delivered. Nothing ever re-sends it (the
// coworker's bench has no grace seat — src/engines/coworker-run.ts:569
// seats [privilege, liveness, birth, stall]; the fan-out twin DOES
// have one, orchestrator.ts:843-852), so the member's first user
// message is a bare relay or a nudge — neither carries the brief, so
// the booking marker never rides the first user message, the session
// never books, and the exchange loses the member.
//
// The law this asserts is the one the diff itself quotes
// (src/engines/coworker.ts:267-276): the resolver matches the marker
// against the FIRST USER MESSAGE — "which is this text (the brief
// file's content, submitted as the prompt, or composed into the first
// relay by combineFirstPrompt)".
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

test("an initiating member whose BRIEF submission fails still gets a first user message with the booking marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tests-birth-marker-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "tests-birth-marker"',
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

  // hermetic against the machine's real opencode store (gate-r27): the
  // booking oracle reads the store, so point it at an empty temp db
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
    // the BIRTH brief submission to alpha fails — the pane is not ready
    // yet (opencode-host.ts:137 logs it and still returns true)
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
    const report = await runCoworker(rail, { stallMs: 60, beatMs: 10 })
    const alphaRow = report?.table?.find((row) => row.unit === "alpha")

    const marker = join(dir, "briefs")
    assert.ok(alphaTexts.length > 0, "the member must have received a first user message at all")
    const first = alphaTexts[0]!
    assert.ok(
      first.includes(marker),
      `the member's FIRST user message must carry the booking marker ${marker} — it received ${JSON.stringify(first.slice(0, 220))} (the brief submission failed at birth; the run then reports ${JSON.stringify(alphaRow?.result ?? null)} for it)`,
    )
  } finally {
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
