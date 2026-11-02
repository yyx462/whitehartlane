// test/review/momentum-1.test.ts
//
// The #266 marker must ride the FIRST user message of every coworker
// member. The change's own claim (src/engines/coworker.ts:267-276) says
// the resolver matches the marker against the FIRST USER MESSAGE — "which
// is this text (the brief file's content, submitted as the prompt)".
// That is the PRD's law for a held member (docs/prd/coworker.md:41-44:
// "its first prompt is brief and first message together").
//
// The relay path breaks that law on its failure branch: the member is
// marked "prompted" BEFORE the prompt succeeds
// (src/engines/coworker-run.ts:711-719), so a first prompt that fails
// (a pane still booting, a blocked pane) is retried as a BARE relay —
// the brief never reaches the member. The booking marker therefore never
// rides the first user message, the session never books, and the birth
// judge kills the member ("dead at birth") — the exact failure #266 was
// filed for.
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

test("a held member's first user message carries the booking marker even when the first relay prompt fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "momentum-marker-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "momentum-marker"',
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
    // the FIRST prompt to beta fails — the pane is not ready yet
    const inner = herdr.runner
    let refused = false
    herdr.runner = (args: string[]) => {
      if (args[0] === "agent" && args[1] === "prompt" && String(args[2]).includes("beta") && !refused) {
        refused = true
        return { status: 1, stdout: "" }
      }
      return inner(args)
    }
    const ledger = fakeLedger()
    const rail = fakeRail(dir, herdr, ledger as never)
    const betaTexts: string[] = []
    herdr.onPrompt = (name, text, later) => {
      if (name.includes("beta")) {
        betaTexts.push(text)
        return
      }
      if (!name.includes("alpha")) return
      later(() => {
        mkdirSync(join(dir, "messages"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "1-alpha.json"),
          JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
        )
      })
    }
    await runCoworker(rail, { stallMs: 60, beatMs: 10 })

    const first = betaTexts[0] ?? ""
    const marker = join(dir, "briefs")
    assert.ok(
      first.includes(marker),
      `the member's FIRST user message must carry the booking marker ${marker} — it received ${JSON.stringify(first.slice(0, 220))}`,
    )
  } finally {
    if (prevDb === undefined) delete process.env.OPENCODE_DB
    else process.env.OPENCODE_DB = prevDb
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
  }
})
