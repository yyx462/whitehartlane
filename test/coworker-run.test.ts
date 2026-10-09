import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
