import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLab } from "../src/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

// The lab engine, driven end to end over scripted agents: the actor
// writes protocol.json, a mock completes its unit (done line + result),
// the wave closes, the actor stops, the report lands.

async function labDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  writeFileSync(join(dir, "workflow.toml"), [
    'kind = "lab"',
    "",
    "[workflow]",
    'name = "test-lab"',
    'worker_kind = "opencode"',
    "",
    "[hooks]",
    "units = \"true\"",
    'grade = "g() { test -s units/$1/result.md && echo planted; }; g"',
    'counts = "printf \'{}\'"',
    "",
  ].join("\n"))
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")
  return dir
}

test("the lab engine runs a wave: actor names it, the mock plants it, the actor stops", async () => {
  const dir = await labDir("lab-run-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never)

  let actorPrompts = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("actor")) {
      actorPrompts += 1
      later(() => {
        if (actorPrompts === 1) {
          // the actor names the first wave
          writeFileSync(join(dir, "protocol.json"), JSON.stringify({
            units: [{ id: "flag", brief: "Plant the flag in result.md." }],
          }))
        } else {
          // wave closed — stop
          writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))
        }
      })
      return
    }
    if (name.startsWith("mock")) {
      // the mock obeys its brief: append the done line to the log,
      // write the deliverable, and touch the task dir so the engine's
      // watcher wakes (unit dirs are not watched)
      const lines = text.split("\n")
      const at = lines.findIndex((l) => l.includes("append exactly this line to the log file"))
      const logPath = at >= 0 ? lines[at + 1]!.replace(/ *:$/, "") : null
      const doneLine = at >= 0 ? lines[at + 2] : null
      const resultPath = text.match(/\/\S*result\.md/)?.[0]
      later(() => {
        if (logPath && doneLine) writeFileSync(logPath, `${doneLine}\n`)
        if (resultPath) writeFileSync(resultPath, "🚩 planted\n")
        writeFileSync(join(dir, ".beat"), String(actorPrompts))
      })
    }
  }

  const report = await runLab(rail)
  assert.ok(report, "the lab finished with a report")
  assert.equal(report.status, "done")
  const flag = report.table.find((row) => row.unit === "flag")
  assert.ok(flag, "the flag unit is in the report")
  assert.match(String(flag.result), /planted/)
  assert.equal(existsSync(join(dir, "units", "flag", "result.md")), true)
  assert.equal(existsSync(join(dir, "report.json")), true)
  // births booked on the ledger (runLab reports settles, the rail
  // books the panes — unit.settled is the fan-out engine's event)
  assert.ok(ledger.attached.some((label) => label.includes("mock-flag")))
  assert.ok(ledger.attached.some((label) => label.includes("actor")))
})

test("the lab engine throws on a gate step with no detector", async () => {
  const dir = await labDir("lab-gate-")
  writeFileSync(join(dir, "dag.mjs"), [
    "export const dag = {",
    '  name: "gated",',
    "  steps: [",
    '    { id: "open", does: "gate" },',
    "  ],",
    "}",
    "",
  ].join("\n"))
  const rail = fakeRail(dir, fakeHerdr(), null)
  await assert.rejects(() => runLab(rail), /gate step open/)
})
