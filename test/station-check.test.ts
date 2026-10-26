// station-check.test.ts — the station twin of #198's audit-before-retire:
// a coworker stage's `check` runs IN-EXCHANGE at the stop, before the
// member panes retire. Red round 1 is a revise round handed to the
// stop's author (verbatim stderr) while the panes still live; green
// stands; a second red ends the exchange honestly and fails the step.
// Before, the parent ran the check AFTER the exchange returned — every
// pane already retired — so red could only fail the step, never be
// fixed by the minds that caused it (run #17's class: the verdict that
// fires after the workforce is gone).
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runCoworker, type StationSpec } from "../src/engines/coworker-run.ts"
import { runOrchestrator } from "../src/engines/orchestrator.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-station-check-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

// the stage check: appends a run mark (cwd = the PARENT, where the
// stage was declared) and demands the FINAL section — the shelf the
// exchange is claiming as done
const CHECK_SH = 'set -uo pipefail\nprintf run >> check-ran.txt\ngrep -q FINAL stations/review/data/gaps.md || { echo "gaps.md: no FINAL section" >&2; exit 1; }\n'

// engine-level fixture: a parent dir (workflow + hooks/) hosting one
// station at stations/review/ whose members' briefs are pre-written
function stationCase(prefix: string): { parent: string; station: string; spec: StationSpec } {
  const parent = join(process.env.AGENTIC_OS_HOME!, prefix)
  const station = join(parent, "stations", "review")
  mkdirSync(join(parent, "hooks"), { recursive: true })
  writeFileSync(
    join(parent, "workflow.toml"),
    ['[workflow]', 'name = "station-check"', 'worker_kind = "opencode"', "", "[members.alex]", "initiates = true", "", "[members.sam]", ""].join("\n"),
  )
  writeFileSync(join(parent, "hooks", "stage-check.sh"), CHECK_SH)
  mkdirSync(join(station, "members"), { recursive: true })
  writeFileSync(join(station, "members", "alex.md"), "Mail sam the question.\n")
  writeFileSync(join(station, "members", "sam.md"), "Fold the answer into gaps.md, then stop the exchange.\n")
  return {
    parent,
    station,
    spec: {
      dir: station,
      members: [
        { name: "alex", initiates: true },
        { name: "sam" },
      ],
      workerKind: "opencode",
      check: "bash hooks/stage-check.sh",
      checkCwd: parent,
    },
  }
}

const runsOf = (dir: string): number =>
  existsSync(join(dir, "check-ran.txt")) ? readFileSync(join(dir, "check-ran.txt"), "utf8").split("run").length - 1 : 0

const mail = (station: string, who: string, seq: number, to: string, type: string, body: string) => {
  mkdirSync(join(station, "messages", who), { recursive: true })
  writeFileSync(join(station, "messages", who, `${seq}.json`), JSON.stringify({ from: who, to, type, body }))
}

test("a station's red check is a revise round at the stop's author — green closes done", async () => {
  const { parent, station, spec } = stationCase("revise-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(parent, herdr, ledger as never)
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("alex")) {
      later(() => mail(station, "alex", 1, "sam", "note", "the answer is 42"))
      return
    }
    if (name.startsWith("sam")) {
      if (text.includes("brief") || !text.includes("verdict hook failed")) {
        // first turn: the shelf is NOT done yet — claim it anyway (the bug shape)
        later(() => {
          mkdirSync(join(station, "data"), { recursive: true })
          writeFileSync(join(station, "data", "gaps.md"), "gap 1: open\n")
          mail(station, "sam", 2, "alex", "stop", "done")
        })
        return
      }
      // the revise round: the check's stderr arrived VERBATIM — fix exactly what it names
      assert.match(text, /verdict hook failed/, "the revise note names the verdict")
      assert.match(text, /gaps\.md: no FINAL section/, "the check's stderr rides verbatim")
      later(() => {
        writeFileSync(join(station, "data", "gaps.md"), "gap 1: refuted\ngap 2: FINAL stands\n")
        mail(station, "sam", 3, "alex", "stop", "fixed — done")
      })
      return
    }
  }
  const report = await runCoworker(rail, { station: spec, stallMs: 1000, beatMs: 10 })
  assert.equal(report?.status, "done", "the revise round healed the stage check in-exchange")
  assert.equal(report?.table.find((row) => row.unit === "verdict"), undefined, "no verdict row when it heals")
  assert.equal(runsOf(parent), 2, "the check ran once per stop — red, then green")
})

test("a second station-check red ends the exchange honestly — the verdict row rides the report", async () => {
  const { parent, station, spec } = stationCase("twored-")
  const herdr = fakeHerdr()
  const rail = fakeRail(parent, herdr, null)
  let samStops = 0
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alex")) {
      later(() => mail(station, "alex", 1, "sam", "note", "the answer is 42"))
      return
    }
    if (name.startsWith("sam")) {
      samStops += 1
      later(() => {
        mkdirSync(join(station, "data"), { recursive: true })
        writeFileSync(join(station, "data", "gaps.md"), "gap 1: still open\n")
        mail(station, "sam", samStops + 1, "alex", "stop", "done")
      })
      return
    }
  }
  const report = await runCoworker(rail, { station: spec, stallMs: 1000, beatMs: 10 })
  assert.equal(report?.status, "failed", "two reds fail the exchange honestly")
  const row = report?.table.find((r) => r.unit === "verdict")
  assert.ok(row, "the verdict row rides the station's report")
  assert.match(row!.result, /verdict hook failed twice/)
  assert.equal(runsOf(parent), 2, "one check per stop, never a third")
})

test("chain level: the stage check runs exactly once — in-exchange — and the step carries its receipt", async () => {
  const dir = join(process.env.AGENTIC_OS_HOME!, "chain-")
  mkdirSync(join(dir, "hooks"), { recursive: true })
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "station-check-chain"
worker_kind = "opencode"

[[stage]]
id = "review"
topology = "coworker"
check = "bash hooks/stage-check.sh"

[[stage.members]]
name = "alex"
brief = "tell sam the answer"
initiates = true

[[stage.members]]
name = "sam"
brief = "on alex's mail, finish gaps.md and stop the exchange"

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  writeFileSync(join(dir, "hooks", "stage-check.sh"), CHECK_SH)
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)
  const station = join(dir, "stations", "review")
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alex")) {
      later(() => mail(station, "alex", 1, "sam", "note", "the answer is 42"))
      return
    }
    later(() => {
      mkdirSync(join(station, "data"), { recursive: true })
      writeFileSync(join(station, "data", "gaps.md"), "gap 1: refuted\ngap 2: FINAL stands\n")
      mail(station, "sam", 2, "alex", "stop", "done")
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
  // the check fired EXACTLY once — the parent must not judge the same
  // shelf a second time after the members retired
  assert.equal(runsOf(dir), 1, "the stage check ran once, in-exchange")
  const row = report.table.find((r) => r.unit === "review")
  assert.ok(row, "the station step rides the report")
  assert.match(row!.result, /audited in-exchange/, "the row names where the audit ran")
})
