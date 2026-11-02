// empty pin — the new opts.roster seat does not share parseRosterKey's
// "empty means no contract, never an empty universe" law.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runGate } from "../../src/doors/review-gate.ts"

process.env.AGENTIC_OS_NOTIFY = "0"
process.env.WHL_GATE_LEDGER = join(mkdtempSync(join(tmpdir(), "aos-tests1-led-")), "gate.jsonl")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm feat")
  return where
}

test("empty roster pin is not a zero-lens full rail (INV-3)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests1-empty-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const { decision } = runGate(repo, "main", "feat", { jev: false, roster: [] })
    assert.ok(
      decision.roster.length > 0 && decision.roster.includes("momentum"),
      `INV-3: empty roster must mean no contract (all four), not a review whose roster is empty while claiming a full rail. got action=${decision.action} roster=${JSON.stringify(decision.roster)} universe=${JSON.stringify(decision.universe)} why=${decision.why}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
