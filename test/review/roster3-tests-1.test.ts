// INV-4: the door's refusal line and the decision must name the SAME universe.
// A valid csv spelling (roster = "principles,tests") is both a ceiling and
// an "unknown". The review door prints "ALL FOUR lenses are the ceiling"
// whenever rosterUnknown is set, while the same run's receipt names the
// narrower universe the fail-safe actually filled to.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const bin = new URL("../../bin/whitehartlane", import.meta.url).pathname
const stub = new URL("../orchestrator-stub.mjs", import.meta.url).pathname

test("INV-4: csv roster refusal must not claim a universe the gate does not run", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tests-1-csv-"))
  const repo = join(tmp, "repo")
  const prevLedger = process.env.WHL_GATE_LEDGER
  const prevHome = process.env.AGENTIC_OS_HOME
  const prevJev = process.env.WHL_JEV_BIN
  process.env.WHL_GATE_LEDGER = join(tmp, "ledger.jsonl")
  process.env.AGENTIC_OS_HOME = tmp
  process.env.WHL_JEV_BIN = "/nonexistent/jev-tests-1"
  try {
    execSync("git init -q -b main repo", { cwd: tmp })
    execSync("git config user.email t@t && git config user.name t", { cwd: repo })
    writeFileSync(join(repo, "wait.ts"), "export const wait = () => true\n")
    writeFileSync(join(repo, "review-gate.toml"), 'strictness = "medium"\nroster = "principles,tests"\n')
    execSync("git add -A && git commit -qm base", { cwd: repo })
    execSync("git checkout -q -b feat", { cwd: repo })
    writeFileSync(join(repo, "wait.ts"), "export const wait = () => false\n")
    execSync("git add -A && git commit -qm feat", { cwd: repo })

    const env = {
      ...process.env,
      AGENTIC_OS_ORCHESTRATOR: stub,
      WHL_GATE_LEDGER: join(tmp, "door.jsonl"),
      AGENTIC_OS_HOME: tmp,
      WHL_JEV_BIN: "/nonexistent/jev-tests-1",
    }
    const door = spawnSync(
      "node",
      ["--experimental-strip-types", bin, "review", repo, "--base", "main", "--head", "feat", "--gate-only"],
      { encoding: "utf8", env, timeout: 30000 },
    )
    const both = `${door.stdout}\n${door.stderr}`
    assert.equal(door.status, 0, `premise: gate-only must decide, not crash: ${both}`)
    const claimsAllFour = /ALL FOUR lenses are the ceiling/.test(both)
    const caps = /universe: principles,tests/.test(both)
    assert.ok(
      !(claimsAllFour && caps),
      `INV-4: door claimed all four lenses while the same run's receipt capped the universe — refusal and decision must name one ceiling\n${both}`,
    )
  } finally {
    if (prevLedger === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prevLedger
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    if (prevJev === undefined) delete process.env.WHL_JEV_BIN
    else process.env.WHL_JEV_BIN = prevJev
    rmSync(tmp, { recursive: true, force: true })
  }
})
