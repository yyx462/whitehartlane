// test/review/momentum-3101.test.ts
//
// #266 / the "prompted" stamp: the change moved ONE decision — "has this
// member been briefed?" — to stamp ONLY on a successful prompt
// (src/engines/coworker-run.ts:711-727, the relay path). Its twin in the
// SAME file was left as it was: the BIRTH site stamps the member as
// prompted on `ok` alone (src/engines/coworker-run.ts:239), and `ok`
// means "the agent started", NOT "the brief arrived" — the brief
// submission's rc is swallowed inside the host
// (src/adapters/opencode-host.ts:135-139: "brief submission failed for
// {label} — the grace reprompt will retry", and inhabit() still returns
// true).
//
// So on the birth path a member whose brief submission FAILED is marked
// briefed: the relay path's fix (retry the first prompt WITH the brief)
// never applies to it, nothing re-briefs it, and the member's first user
// message is a bare rail nudge with no booking marker in it
// (src/engines/coworker-run.ts:539-543) — the member never books and the
// birth judge kills live working members (the #266 death, one path over).
//
// INVARIANT under test (the change's own claim, test/coworker.test.ts:141
// and test/actor-brief.test.ts:16): EVERY member's first user message
// carries the booking marker dirname(briefPath) = <taskDir>/briefs, so the
// resolver (src/adapters/transcripts.ts:151-158, the first-user-message
// marker check) can book it.
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

test("a member whose BIRTH brief submission failed is still briefed — its first user message carries the booking marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "momentum-birth-marker-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "momentum-birth-marker"',
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

  // hermetic against the machine's real opencode store (the booking
  // oracle reads the store)
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
    // the BIRTH brief submission of the initiating member fails (a pane
    // that is not ready yet — the same class the relay path now retries)
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
    await runCoworker(rail, { stallMs: 60, beatMs: 10 })

    const marker = join(dir, "briefs")
    const first = alphaTexts[0] ?? ""
    assert.ok(
      first.includes(marker),
      `INV-4/#266: the member's FIRST user message must carry the booking marker ${marker} — ` +
        `its birth brief submission failed (rc=1) and nothing re-briefed it, so its first user message is ${JSON.stringify(first.slice(0, 200))} ` +
        `(the birth site stamps 'prompted' on ok alone, so the relay path's retry never applies to it)`,
    )
  } finally {
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
