import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// the ledger rides the OS-disk trace and the boarding oracle reads the
// opencode store — pin both before anything imports the store (the
// repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-m104-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"
// A READABLE store whose tables are EMPTY: any session id probed
// against it is disproven (momentum-80's device) — this is not a
// store-less world (an unreadable store spares, momentum-34).
const DB = join(mkdtempSync(join(tmpdir(), "whl-m104-db-")), "opencode.db")
process.env.OPENCODE_DB = DB

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { runCoworker } from "../../src/engines/coworker-run.ts"
import { loadManifest } from "../../src/doors/hooks.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the momentum-14 device): the member birth seat and
// its raw-row oracle are this diff's own additions to coworker-run.ts.
// Vacuous green on BASE.
const HAS_BIRTH_SEAT = readFileSync(join(ROOT, "src", "engines", "coworker-run.ts"), "utf8").includes("everBookedRow")

function coworkerDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "m104-coworker"',
      'worker_kind = "opencode"',
      "born_ms = 30000",
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
  return dir
}

test("a member whose predecessor generation booked is still judged when THIS generation never boards (the raw-row spare must not survive the respawn/resume arc)", async () => {
  if (!HAS_BIRTH_SEAT) return // BASE: no member birth seat — nothing to judge

  // HEAD-only oracle (added by this diff): imported lazily so the BASE
  // leg of the prove gate loads this file cleanly
  const { opencodeSessionActiveSince } = await import("../../src/adapters/transcripts.ts")

  // the store the oracles read: schema present, rows absent —
  // "ses-dead-predecessor" is therefore provably NOT active this
  // generation (momentum-80: a readable store with no row disproves)
  const db = new DatabaseSync(DB)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.close()

  // premise: the repo's own oracle disproves the predecessor pointer
  assert.equal(
    opencodeSessionActiveSince("ses-dead-predecessor", Date.now() - 60_000),
    false,
    "premise: the readable-but-empty store disproves the predecessor session (momentum-80's device)",
  )

  const dir = coworkerDir("whl-m104-run-")
  try {
    // premise: the parser accepts born_ms for this coworker program
    const manifest = loadManifest(dir) as { workflow?: { born_ms?: number } }
    assert.equal(manifest.workflow?.born_ms, 30000, "premise: born_ms accepted for the coworker program")

    const herdr = fakeHerdr()
    const ledger = fakeLedger()
    // THE PREDECESSOR GENERATION: a pane row for alpha from an earlier
    // incarnation carries a session pointer (the liveness-respawn and
    // ADR-5 resume arcs both leave exactly this ledger behind). The
    // store above disproves the pointer — the same file's own law
    // (bookedSessionOf, "momentum-90's law at the coworker seat") says
    // a pointer is evidence only when active THIS generation.
    ledger.job.panes.push({
      label: "alpha",
      pane: "p-gen0",
      unit: "alpha",
      transcript: { tool: "opencode", session_id: "ses-dead-predecessor" },
      born: new Date(Date.now() - 60_000).toISOString(),
    })

    // THIS generation: agent start SUCCEEDS but no session EVER lands,
    // and the multiplexer reports "working" forever (the #249 class) —
    // the exact shape memberBirthJudge was seated to judge.
    const origRunner = herdr.runner.bind(herdr)
    herdr.runner = ((args: string[]) => {
      const out = origRunner(args)
      if (args[0] === "agent" && args[1] === "start") herdr.phase[args[2]!] = "working"
      return out
    }) as typeof herdr.runner
    herdr.onPrompt = () => {} // never boards, never mails

    const rail = fakeRail(dir, herdr, ledger as never)

    // bound the exchange: the stop lands from beta at 2.5s — the
    // judgment window under test is everything before it (≈40 beats at
    // 60ms; bornPatience = min(30000, stallMs 300) = 300ms, so the
    // birth seat gets ~35 looks inside the window)
    setTimeout(() => {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "1-beta.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "bound the run" }),
      )
    }, 2_500).unref()

    const run = Promise.race([
      runCoworker(rail, { stallMs: 300, beatMs: 60, graceMs: 0 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("the exchange never ended — the repro bound failed")), 15_000).unref(),
      ),
    ])
    await run

    // premise: alpha never boarded THIS generation — every row the run
    // attached carries no session, and the ONLY pointer on alpha's rows
    // is the predecessor's, which the store disproves
    const alphaRows = ledger.job.panes.filter((p) => p.unit === "alpha")
    assert.ok(alphaRows.length >= 2, `sanity: the predecessor row plus the run's own birth (${alphaRows.length} rows)`)
    assert.ok(
      alphaRows.every((p) => !p.transcript?.session_id || p.transcript.session_id === "ses-dead-predecessor"),
      "premise: alpha never boarded this generation (no new session on any of its rows)",
    )

    // THE LAW: the fan-out bench answers "did this pane ever board?"
    // with the ACTIVITY-VERIFIED oracle (orchestrator.ts birthJudge →
    // faults.sessionOf → rail.bookedSessionOf: "ACTIVITY IS THE
    // ORACLE … the pointer is evidence only when the session is real
    // AND active THIS generation"), and the coworker file itself
    // pinned the same law one function over (bookedSessionOf,
    // "momentum-90's law at the coworker seat"). The member birth seat
    // instead reads the RAW ROW across ALL generations
    // (coworker-run.ts everBookedRow): the predecessor's disproven
    // pointer reads as boarding, the judge returns none forever, the
    // stall judge defers "working" unconditionally, liveness sees a
    // live pane — the respawned/resumed member that never re-boards
    // rides the whole exchange, the exact ride the seat exists to cut.
    const birthRulings = ledger.events.filter(
      (e) =>
        (e.kind === "retry" && String((e.payload as { member?: string }).member) === "alpha") ||
        (e.kind === "unit.reborn" && String((e.payload as { unit?: string }).unit) === "alpha") ||
        (e.kind === "wake" && String((e.payload as { why?: string }).why ?? "").includes("dead at birth")),
    )
    assert.ok(
      birthRulings.length > 0,
      `INV-3: "did this pane ever board?" is ONE decision and the two benches answer it with opposite ` +
        `oracles. The predecessor pointer on alpha's gen-0 row is DISPROVEN by the store ` +
        `(opencodeSessionActiveSince → false — the premise above; the same file's bookedSessionOf answers ` +
        `undefined on it and alpha was born FRESH), yet everBookedRow (coworker-run.ts, the memberBirthJudge's ` +
        `spared-path) scans ALL generations' raw rows and answers TRUE — the judge spares a pane that never ` +
        `boarded this generation, the stall judge defers "working" unconditionally, and alpha rode the entire ` +
        `exchange with zero birth-class rulings (events: ${JSON.stringify(ledger.events.map((e) => e.kind))}). ` +
        `The fan-out twin (orchestrator.ts birthJudge via rail.bookedSessionOf) and this file's own resume ` +
        `oracle both verify activity this generation (momentum-90's law); the birth seat must not read a dead ` +
        `predecessor's booking as boarding — respawn it (transport class, capped) or close it as a fault.`,
    )
  } finally {
    rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
