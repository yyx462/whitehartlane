// usage.test.ts — #104 / #201 accounting: the host usage reader
// (opencode's sqlite db) and the trace's turn.tokens rows. The reader
// is pinned against a fixture db; the emission against a full fake
// exchange with OPENCODE_DB pointed at that fixture.
import { DatabaseSync } from "node:sqlite"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"
import { runCoworker } from "../src/engines/coworker-run.ts"

const SCHEMA = `CREATE TABLE session_v2 (
  id TEXT PRIMARY KEY, directory TEXT NOT NULL, time_created INTEGER NOT NULL,
  tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
  tokens_cache_read INTEGER DEFAULT 0, cost REAL DEFAULT 0
)`

function fixtureDb(rows: { dir: string; at: number; input: number; output: number; cache: number; cost: number }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "whl-usage-db-"))
  const db = new DatabaseSync(join(dir, "opencode.db"))
  db.exec(SCHEMA)
  for (const [i, r] of rows.entries()) {
    db.prepare("INSERT INTO session_v2 (id, directory, time_created, tokens_input, tokens_output, tokens_cache_read, cost) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(`ses_${i}`, r.dir, r.at, r.input, r.output, r.cache, r.cost)
  }
  db.close()
  return join(dir, "opencode.db")
}

test("opencodeUsageOf sums the sandbox window — retries included, neighbors excluded", async () => {
  const { opencodeUsageOf } = await import("../src/adapters/transcripts.ts")
  const sandboxA = mkdtempSync(join(tmpdir(), "whl-usage-a-"))
  const sandboxB = mkdtempSync(join(tmpdir(), "whl-usage-b-"))
  const since = Date.now() - 1000
  const db = fixtureDb([
    { dir: sandboxA, at: since + 10, input: 100, output: 10, cache: 50, cost: 0.001 },
    { dir: sandboxA, at: since + 20, input: 30, output: 5, cache: 0, cost: 0.0005 }, // the retry
    { dir: sandboxB, at: since + 30, input: 999, output: 99, cache: 9, cost: 9 }, // a sibling, excluded
    { dir: sandboxA, at: since - 500, input: 777, output: 77, cache: 7, cost: 7 }, // before the window
  ])
  process.env.OPENCODE_DB = db
  try {
    const usage = opencodeUsageOf(sandboxA, since)
    assert.ok(usage, "the fixture db answers")
    assert.equal(usage.input, 130, "two in-window sessions summed")
    assert.equal(usage.output, 15)
    assert.equal(usage.cacheRead, 50)
    assert.equal(usage.cost, 0.0015)
    assert.equal(usage.sessions, 2, "the retry counts as the run's cost")
    assert.equal(opencodeUsageOf(sandboxA, Date.now() + 10_000), null, "an empty window is null, not fake zeros")
  } finally {
    delete process.env.OPENCODE_DB
  }
})

test("each relay emits turn.tokens on the trace; the report carries per-member cost rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-usage-run-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "usage"',
      'worker_kind = "opencode"',
      "",
      "[members.alpha]",
      "initiates = true",
      "",
      "[members.beta]",
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "Tell beta the answer, then let it stop.\n")
  writeFileSync(join(dir, "members", "beta.md"), "On alpha's mail, stop the exchange.\n")
  writeFileSync(
    join(dir, "contract.toml"),
    "[[contract.deliverables]]\nname = \"exchange-record\"\npath = \"relay.json\"\nkind = \"json\"\n",
  )
  // the fixture db answers for BOTH member sandboxes (the engine's
  // hosts read it through OPENCODE_DB); far-future time_created keeps
  // every row inside the since-window
  const db = fixtureDb([
    { dir: join(dir, "sandboxes", "alpha"), at: Date.now() + 100_000, input: 210, output: 21, cache: 5, cost: 0.0021 },
    { dir: join(dir, "sandboxes", "beta"), at: Date.now() + 100_000, input: 40, output: 4, cache: 0, cost: 0.0004 },
  ])
  process.env.OPENCODE_DB = db

  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  let rail: ReturnType<typeof fakeRail> | null = null
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      later(() => {
        mkdirSync(join(dir, "messages", "alpha"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "alpha", "2.json"),
          JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "the answer is 42" }),
        )
      })
      return
    }
    later(() => {
      mkdirSync(join(dir, "messages", "beta"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "beta", "3.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
      )
    })
  }
  try {
    rail = fakeRail(dir, herdr, ledger as never)
    const report = await runCoworker(rail)
    assert.ok(report)
    assert.equal(report.status, "done")

    // the trace: one turn.tokens row per relay, naming the SENDER
    const turns = ledger.events.filter((e) => e.kind === "turn.tokens")
    assert.equal(turns.length, 1, "alpha's delivered mail sampled its turn")
    assert.equal(turns[0]!.payload.member, "alpha")
    assert.equal(turns[0]!.payload.input, 210)
    assert.equal(turns[0]!.payload.output, 21)

    // the report: a cost row per member, cumulative
    const table = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { table: { unit: string; result: string }[] }
    const alphaRow = table.table.find((r) => r.unit === "tokens alpha")
    const betaRow = table.table.find((r) => r.unit === "tokens beta")
    assert.ok(alphaRow?.result.includes("in 210 / out 21"), `alpha's row: ${alphaRow?.result}`)
    assert.ok(betaRow?.result.includes("in 40 / out 4"), `beta's row: ${betaRow?.result}`)
  } finally {
    delete process.env.OPENCODE_DB
  }
})
