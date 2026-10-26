// send-tool.test.ts — ADR 0016 slice 5: the send tool is the only
// sanctioned sender, the mailbox scope closes the forgery hole, and
// the rail-written ledger accounts every new mail.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"
import { runCoworker } from "../src/engines/coworker-run.ts"

process.env.AGENTIC_OS_HOME ??= mkdtempSync(join(tmpdir(), "whl-sendtool-"))
process.env.AGENTIC_OS_NOTIFY = "0"

function coworkerDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "send-tool"',
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
  writeFileSync(join(dir, "members", "alpha.md"), "Greet beta, then let it stop.\n")
  writeFileSync(join(dir, "members", "beta.md"), "On alpha's mail, stop.\n")
  return dir
}

test("birth stages the send tool + roster and scopes each mailbox to its owner", async () => {
  const dir = coworkerDir("whl-st-scope-")
  const ledger = fakeLedger()
  let settled = false
  const h = fakeHerdr()
  const r = fakeRail(dir, h, ledger as never)
  h.onPrompt = (name, _text, later) => {
    if (name.startsWith("alpha")) {
      later(() => {
        mkdirSync(join(dir, "messages", "alpha"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "alpha", "2.json"),
          JSON.stringify({ from: "alpha", to: "beta", type: "note", body: "hello beta" }),
        )
      })
      return
    }
    if (!settled && name.startsWith("beta")) {
      later(() => {
        settled = true
        mkdirSync(join(dir, "messages", "beta"), { recursive: true })
        writeFileSync(
          join(dir, "messages", "beta", "3.json"),
          JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal" }),
        )
      })
    }
  }
  const report = await runCoworker(r)
  assert.ok(report)
  // the tool + roster are staged by the rail, once
  assert.ok(existsSync(join(dir, "tools", "send.mjs")))
  assert.equal(readFileSync(join(dir, "tools", "roster.txt"), "utf8"), "alpha\nbeta\n")
  // every member's brief teaches the tool
  for (const m of ["alpha", "beta"]) {
    assert.match(readFileSync(join(dir, "briefs", `${m}.md`), "utf8"), /tools\/send\.mjs/)
  }
  // the scope law: own outbox + data/ shelf granted, the PEER's outbox
  // in NO member's scope — a forged write is out of scope by construction
  for (const m of ["alpha", "beta"]) {
    const cfg = JSON.parse(readFileSync(join(dir, "sandboxes", m, "opencode.json"), "utf8"))
    const keys = Object.keys(cfg.permission.external_directory).join(" ")
    assert.ok(keys.includes(`/messages/${m}`), `${m} may write its own outbox`)
    const peer = m === "alpha" ? "beta" : "alpha"
    assert.ok(!keys.includes(`/messages/${peer}`), `${m}'s scope must not name ${peer}'s outbox`)
    assert.ok(keys.includes("/data"), `${m} shares the data/ shelf`)
    // the human pack is authored in place — same grant as data/
    assert.ok(keys.includes("/deliverables"), `${m} shares the deliverables/ pack`)
  }
  // the rail-written ledger: every new mail accounted the beat it parses
  const filed = ledger.events.filter((e) => e.kind === "mail.filed")
  assert.equal(filed.length, 2, "both mails accounted once each")
  assert.deepEqual(filed.map((e) => e.payload.from), ["alpha", "beta"])
  assert.equal(filed[1]!.payload.type, "stop")
})

test("the tool files your outbox, assigns the seq, and refuses everything else", () => {
  const dir = coworkerDir("whl-st-tool-")
  // stage the tool + roster exactly as the engine does
  mkdirSync(join(dir, "tools"), { recursive: true })
  execFileSync("cp", [join(import.meta.dirname, "..", "src", "engines", "send-tool.mjs"), join(dir, "tools", "send.mjs")])
  writeFileSync(join(dir, "tools", "roster.txt"), "alpha\nbeta\n")
  // a sandbox for alpha, with existing mail at seq 3 in the peer's box
  const sandbox = join(dir, "sandboxes", "alpha")
  mkdirSync(sandbox, { recursive: true })
  mkdirSync(join(dir, "messages", "beta"), { recursive: true })
  writeFileSync(join(dir, "messages", "beta", "3.json"), "{}")
  const send = (args: string[]) => spawnSync(process.execPath, [join(dir, "tools", "send.mjs"), ...args], { cwd: sandbox, encoding: "utf8" })

  const ok = send(["beta", "note", "the answer is 42"])
  assert.equal(ok.status, 0, ok.stderr)
  const mail = JSON.parse(readFileSync(join(dir, "messages", "alpha", "4.json"), "utf8"))
  assert.deepEqual(mail, { from: "alpha", to: "beta", type: "note", body: "the answer is 42" })
  assert.ok(!existsSync(join(dir, "messages", "alpha", ".tmp-4.json")), "atomic — no temp left")

  assert.notEqual(send(["gamma", "note", "hi"]).status, 0, "non-roster recipient refused")
  assert.notEqual(send(["alpha", "note", "self"]).status, 0, "self-mail refused")
  assert.notEqual(send(["beta", "shout", "hi"]).status, 0, "unknown type refused")
  assert.notEqual(send(["beta", "note", "   "]).status, 0, "empty body refused")
  // identity is the FOLDER: run from beta's sandbox and it files beta's box
  const betaSandbox = join(dir, "sandboxes", "beta")
  mkdirSync(betaSandbox, { recursive: true })
  const ok2 = send(["alpha", "stop", "goal reached"])
  void ok2
  const fromBeta = spawnSync(process.execPath, [join(dir, "tools", "send.mjs"), "alpha", "stop", "done"], { cwd: betaSandbox, encoding: "utf8" })
  assert.equal(fromBeta.status, 0, fromBeta.stderr)
  assert.equal(JSON.parse(readFileSync(join(dir, "messages", "beta", "5.json"), "utf8")).from, "beta")
})
