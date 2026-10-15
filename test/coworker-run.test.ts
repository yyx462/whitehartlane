import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runCoworker } from "../src/coworker-run.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

// The coworker engine, driven end to end over scripted agents: birth,
// a live permission dialog (allowed inside the member's roots), the
// relay, the stop, and the report. This is the flow the smoke ran —
// now a test.

async function coworkerDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  writeFileSync(join(dir, "workflow.toml"), [
    'kind = "coworker"',
    "",
    "[workflow]",
    'name = "test-coworker"',
    'worker_kind = "opencode"',
    "",
    "[hooks]",
    "units = \"true\"",
    'grade = "echo pass"',
    'counts = "printf \'{}\'"',
    "",
    "[members.alpha]",
    "initiates = true",
    "",
    "[members.beta]",
    "",
  ].join("\n"))
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "Find the capital and tell beta.\n")
  writeFileSync(join(dir, "members", "beta.md"), "Wait for alpha, then wrap up.\n")
  return dir
}

test("the coworker engine runs a full exchange: dialog answered, mail relayed, stop reported", async () => {
  const dir = await coworkerDir("coworker-run-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)

  // alpha's brain: first turn blocks on a permission dialog inside its
  // own sandbox (roots → allow); once answered (enter), it mails beta.
  // beta's brain: on its first mail, the exchange has reached its goal
  // — write the stop.
  let alphaTurn = 0
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      alphaTurn += 1
      herdr.phase[name] = "dialog"
      const sandbox = join(dir, "sandboxes", "alpha")
      mkdirSync(join(sandbox, "notes"), { recursive: true }) // the dialog's subject exists
      herdr.readFor = (n) =>
        n === name ? `Permission required\n\nthe agent wants to write ${sandbox}/notes/x.txt` : herdr.readFor(n)
      herdr.onKeys = (n, key) => {
        if (n === name && key === "enter") {
          herdr.phase[n] = "idle"
          later(() => {
            mkdirSync(join(dir, "messages"), { recursive: true })
            writeFileSync(
              join(dir, "messages", "2-alpha.json"),
              JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
            )
          })
        }
      }
      return
    }
    if (name.startsWith("beta")) {
      later(() => {
        mkdirSync(join(dir, "messages"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "3-beta.json"),
          JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
        )
      })
    }
  }

  const report = await runCoworker(rail)
  assert.ok(report, "the exchange finished with a report")
  assert.equal(report.status, "done")
  assert.equal(existsSync(join(dir, "report.json")), true)

  // the privilege sweep answered the dialog — allow (roots), booked
  const permissions = ledger.events.filter((e) => e.kind === "permission")
  assert.equal(permissions.length, 1)
  assert.equal(permissions[0]!.payload.decision, "allow")

  // the relay delivered alpha's mail and booked it
  const relays = ledger.events.filter((e) => e.kind === "relay")
  assert.equal(relays.length, 1)
  assert.equal(relays[0]!.payload.file, "2-alpha.json")
  const relayLedger = JSON.parse(readFileSync(join(dir, "relay.json"), "utf8")) as { delivered: string[] }
  assert.deepEqual(relayLedger.delivered, ["2-alpha.json"])

  // the durable root grant landed in alpha's sandbox
  assert.equal(existsSync(join(dir, "sandboxes", "alpha", "opencode.json")), true)
})

test("the coworker engine refuses a manifest with fewer than two members", async () => {
  const dir = await coworkerDir("coworker-1member-")
  const toml = readFileSync(join(dir, "workflow.toml"), "utf8").replace(/\[members\.beta\][\s\S]*$/, "")
  writeFileSync(join(dir, "workflow.toml"), toml)
  const rail = fakeRail(dir, fakeHerdr(), null)
  await assert.rejects(() => runCoworker(rail), /at least two/)
})

test("the coworker engine refuses when nobody initiates", async () => {
  const dir = await coworkerDir("coworker-noinit-")
  const toml = readFileSync(join(dir, "workflow.toml"), "utf8").replace("initiates = true\n", "")
  writeFileSync(join(dir, "workflow.toml"), toml)
  const rail = fakeRail(dir, fakeHerdr(), null)
  await assert.rejects(() => runCoworker(rail), /initiates/)
})

test("a pre-declared member root rides the session-start config — the dialogs never fire", async () => {
  const dir = await coworkerDir("coworker-roots-")
  const toml = readFileSync(join(dir, "workflow.toml"), "utf8").replace(
    "[members.alpha]\ninitiates = true",
    '[members.alpha]\ninitiates = true\nroots = ["~/.vista"]',
  )
  writeFileSync(join(dir, "workflow.toml"), toml)
  const herdr = fakeHerdr()
  const rail = fakeRail(dir, herdr, null)
  // alpha goes straight to the stop — no dialog to answer
  herdr.onPrompt = (name, _text, later) => {
    if (!name.startsWith("alpha")) return
    later(() => {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "2-alpha.json"),
        JSON.stringify({ from: "alpha", to: "beta", type: "stop", body: "goal reached" }),
      )
    })
  }
  const report = await runCoworker(rail)
  assert.equal(report?.status, "done")
  // the expanded root landed in alpha's sandbox config at birth
  const cfg = JSON.parse(readFileSync(join(dir, "sandboxes", "alpha", "opencode.json"), "utf8")) as {
    permission: { external_directory: Record<string, string> }
  }
  const home = (await import("node:os")).homedir()
  assert.equal(cfg.permission.external_directory[`${home}/.vista/**`], "allow")
})

test("a deny pattern ends the exchange with its reason in the report", async () => {
  const dir = await coworkerDir("coworker-cap-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)
  // alpha's brain: every prompt — brief, deny note, any nudge — puts it
  // back on the same secrets dialog; a fresh tickle file per beat
  // advances the watcher (directory watches only promise NEW entries)
  let tickles = 0
  herdr.onPrompt = (name, _text, later) => {
    if (!name.startsWith("alpha")) return
    herdr.phase[name] = "dialog"
    herdr.readFor = () => "Permission required\n\nthe agent wants to read /Users/tester/.ssh/id_rsa"
    later(() => {
      tickles += 1
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(join(dir, "messages", `zz-tickle-${tickles}`), "wake the watcher")
    })
  }
  const report = await runCoworker(rail)
  assert.equal(report?.status, "failed")
  const exchange = report?.table.find((row) => row.unit === "exchange")
  assert.ok(exchange, "the exchange row exists")
  assert.match(exchange!.result, /^ended by dead — alpha blocked past the deny cap$/)
  const wake = ledger.events.find((e) => e.kind === "wake")
  assert.ok(wake, "the death woke the ledger")
  assert.match(String(wake!.payload.why), /deny cap/)
})

test("a refused message is quoted in the nudges and the death reason — the member is told why (wave-2)", async () => {
  const dir = await coworkerDir("coworker-refused-")
  // alpha already "sent" its mail — a seq-0 file the relay must
  // refuse — and idles, certain it is done. Pre-seeded so the very
  // first beat records the refusal before any stall fires.
  mkdirSync(join(dir, "messages"), { recursive: true })
  writeFileSync(
    join(dir, "messages", "0-alpha.json"),
    JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
  )
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)
  const nudges: string[] = []
  herdr.onPrompt = (name, text) => {
    if (name.startsWith("alpha") && text.includes("waits on you")) nudges.push(text)
    // alpha idles through every nudge — it believes it already sent
  }
  const report = await runCoworker(rail, { stallMs: 30, beatMs: 10 })

  // both nudges quote the refusal at its sender, with the fix spelled out
  assert.equal(nudges.length, 2)
  for (const n of nudges) {
    assert.match(n, /REFUSED your message file/)
    assert.match(n, /'0-alpha\.json': seq is not a positive integer: 0/)
    assert.match(n, /messages\/<seq>-<your-name>\.json/)
  }
  // the death record and the ledger wake carry the diagnosis, not just "stalled"
  assert.equal(report?.status, "failed")
  const exchange = report?.table.find((row) => row.unit === "exchange")
  assert.match(exchange!.result, /stalled past the nudge cap — 1 message file\(s\) refused by the relay: '0-alpha\.json'/)
  const wake = ledger.events.find((e) => e.kind === "wake")
  assert.match(String(wake!.payload.why), /refused by the relay/)
  // the report row: a levy reading report.json sees the refusals without opening the log
  const relayRow = report?.table.find((row) => row.unit === "relay")
  assert.match(relayRow!.result, /1 message file\(s\) refused by the relay — '0-alpha\.json': seq is not a positive integer: 0/)
  // and the durable relay ledger keeps the why + sender for a resumed run
  const relayLedger = JSON.parse(readFileSync(join(dir, "relay.json"), "utf8")) as {
    refused: string[]
    refusedDetail: { file: string; why: string; from?: string }[]
  }
  assert.deepEqual(relayLedger.refused, ["0-alpha.json"])
  assert.equal(relayLedger.refusedDetail[0]!.from, "alpha")
  assert.match(relayLedger.refusedDetail[0]!.why, /seq/)
})

test("a member that heeds the quoted refusal self-heals — the exchange finishes done", async () => {
  const dir = await coworkerDir("coworker-healed-")
  mkdirSync(join(dir, "messages"), { recursive: true })
  writeFileSync(
    join(dir, "messages", "0-alpha.json"),
    JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
  )
  const herdr = fakeHerdr()
  const rail = fakeRail(dir, herdr, null)
  let alphaPrompts = 0
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      alphaPrompts += 1
      if (alphaPrompts === 2) {
        // the nudge landed with the quote — alpha fixes its mistake:
        // delete the refused file, resend with a proper seq
        later(() => {
          writeFileSync(join(dir, "messages", "1-alpha.json"), JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }))
          rmSync(join(dir, "messages", "0-alpha.json"))
        })
      }
      return
    }
    // beta: first mail means the goal is reached — stop
    later(() => {
      writeFileSync(join(dir, "messages", "2-beta.json"), JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }))
    })
  }
  const report = await runCoworker(rail, { stallMs: 100, beatMs: 10 })

  assert.equal(report?.status, "done", "the healed file relayed and the stop ended the exchange")
  assert.equal(report?.table.find((row) => row.unit === "relay"), undefined, "no unresolved refusals ride the report")
  const relayLedger = JSON.parse(readFileSync(join(dir, "relay.json"), "utf8")) as { delivered: string[] }
  assert.ok(relayLedger.delivered.includes("1-alpha.json"), "the fixed file was delivered")
})

// Issue #122 — a pane death is a transport fault, not a member's
// answer: the rail respawns the member from its booked session, bounded
// by workflow.retry (default 1), and the report carries the churn.
test("a dead member pane is respawned once and the exchange finishes — retries ride the report", async () => {
  const dir = await coworkerDir("coworker-retry-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)
  let alphaTurns = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("alpha")) {
      alphaTurns += 1
      if (alphaTurns === 1) {
        // the first pane dies mid-exchange — a transport fault
        later(() => {
          herdr.phase[name] = "dead"
        })
        return
      }
      // the respawned pane takes the retry prompt and mails beta
      if (text.includes("transport fault")) {
        later(() => {
          mkdirSync(join(dir, "messages"), { recursive: true })
          writeFileSync(
            join(dir, "messages", "2-alpha.json"),
            JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "capital is Paris" }),
          )
        })
      }
      return
    }
    if (name.startsWith("beta")) {
      later(() => {
        mkdirSync(join(dir, "messages"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "3-beta.json"),
          JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
        )
      })
    }
  }
  const report = await runCoworker(rail, { graceMs: 0, stallMs: 60_000, beatMs: 10 })
  assert.equal(report?.status, "done", "the respawn recovered the exchange")
  const retries = report?.table.find((row) => row.unit === "retries")
  assert.ok(retries, "the report carries a retries row")
  assert.match(retries!.result, /alpha×1/)
  const retryEvents = ledger.events.filter((e) => e.kind === "retry")
  assert.equal(retryEvents.length, 1, "one retry booked on the trail")
  assert.equal(retryEvents[0]!.payload.member, "alpha")
})

test("a member that keeps dying exhausts the retry cap and the death is honest", async () => {
  const dir = await coworkerDir("coworker-retry-cap-")
  const herdr = fakeHerdr()
  const rail = fakeRail(dir, herdr, null)
  let alphaTurns = 0
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      alphaTurns += 1
      later(() => {
        herdr.phase[name] = "dead" // dies on every pane, respawn included
      })
      return
    }
  }
  const report = await runCoworker(rail, { graceMs: 0, stallMs: 60_000, beatMs: 10 })
  assert.equal(report?.status, "failed", "the exchange ended unresolved")
  const exchange = report?.table.find((row) => row.unit === "exchange")
  assert.match(exchange!.result, /alpha pane died after 1 transport retry/)
  assert.match(report!.table.find((row) => row.unit === "retries")!.result, /alpha×1/)
})

test("retry = 0 disarms the respawn — first death is final (policy, not reflex)", async () => {
  const dir = await coworkerDir("coworker-retry-0-")
  const toml = join(dir, "workflow.toml")
  writeFileSync(toml, readFileSync(toml, "utf8").replace('name = "test-coworker"', 'name = "test-coworker"\nretry = 0'))
  const herdr = fakeHerdr()
  const rail = fakeRail(dir, herdr, null)
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      later(() => {
        herdr.phase[name] = "dead"
      })
    }
  }
  const report = await runCoworker(rail, { graceMs: 0, stallMs: 60_000, beatMs: 10 })
  assert.equal(report?.status, "failed")
  const exchange = report?.table.find((row) => row.unit === "exchange")
  assert.match(exchange!.result, /alpha pane died(?! after)/, "no retries were spent")
  assert.equal(report!.table.find((row) => row.unit === "retries"), undefined)
})

test("a token-limit screen with an empty ladder ends the member honestly — not as a stall", async () => {
  const dir = await coworkerDir("coworker-budget-")
  const herdr = fakeHerdr()
  herdr.readFor = () => "Error: token limit reached"
  const rail = fakeRail(dir, herdr, null)
  const report = await runCoworker(rail, { graceMs: 60_000, stallMs: 60_000, beatMs: 10 })
  assert.equal(report?.status, "failed")
  const exchange = report?.table.find((row) => row.unit === "exchange")
  assert.match(exchange!.result, /token budget and the model ladder is empty/)
})
