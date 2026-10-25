// station-composite.test.ts — ADR 0016 slice 1's composite case: a
// coworker stage hosted IN-PROCESS by the DEFAULT host (runCoworker on
// the same rail) inside a chain, driven end-to-end with fake panes.
// This is the real hosting contract — briefs written from the stage's
// members, mail exchanged through the station's messages/, the relay
// ledger station-owned, the chain advancing on the exchange's verdict.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator } from "../src/engines/orchestrator.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-station-comp-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

test("the default host seats runCoworker at stations/<id>/ — the composite case", async () => {
  const dir = join(process.env.AGENTIC_OS_HOME!, "composite")
  mkdirSync(join(dir, "hooks"), { recursive: true })
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "composite"
worker_kind = "opencode"

[[stage]]
id = "review"
topology = "coworker"
preamble = "We are building the orders API."
members = [
  { name = "alex", brief = "tell sam the answer", initiates = true },
  { name = "sam", brief = "on alex's mail, stop the exchange" },
]

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  writeFileSync(join(dir, "contract.toml"), "[[contract.deliverables]]\nname = \"exchange-record\"\npath = \"stations/review/relay.json\"\nkind = \"json\"\n")

  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alex")) {
      later(() => {
        mkdirSync(join(dir, "stations", "review", "messages", "alex"), { recursive: true })
        writeFileSync(
          join(dir, "stations", "review", "messages", "alex", "2.json"),
          JSON.stringify({ from: "alex", to: "sam", type: "note", body: "the answer is 42" }),
        )
      })
      return
    }
    later(() => {
      mkdirSync(join(dir, "stations", "review", "messages", "sam"), { recursive: true })
      writeFileSync(
        join(dir, "stations", "review", "messages", "sam", "3.json"),
        JSON.stringify({ from: "sam", to: "alex", type: "stop", body: "goal reached" }),
      )
    })
  }

  const report = await runOrchestrator({
    taskDir: dir,
    shep: rail as never,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 10_000,
    beatMs: 50,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.ok(report, "the chain finished with a report")
  assert.equal(report.status, "done")

  const station = join(dir, "stations", "review")
  // the stage's members became the station's briefs, preamble first
  for (const name of ["alex", "sam"]) {
    const brief = readFileSync(join(station, "briefs", `${name}.md`), "utf8")
    assert.match(brief, /^We are building the orders API\./, `${name}'s brief carries the preamble`)
    assert.match(brief, new RegExp(`^# PROTOCOL|${name}`))
  }
  assert.match(readFileSync(join(station, "members", "alex.md"), "utf8"), /^We are building the orders API\.\n\ntell sam the answer/)
  // the exchange's durable bytes are station-owned
  assert.ok(existsSync(join(station, "relay.json")))
  assert.ok(existsSync(join(station, "report.json")))
  assert.ok(existsSync(join(station, "protocol.json")))
  // NO mint, ever
  assert.equal(existsSync(join(dir, "stages")), false)
  // the run's own report carries the station row, and the gate ran after
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.review, /^station review done/)
})
