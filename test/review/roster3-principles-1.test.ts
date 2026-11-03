// INV-4 / INV-3: a csv roster string is a spelling the parser accepts.
// parseRosterKey honors the ids as the ceiling AND surfaces the raw
// string as rosterUnknown. The door and ship-config treat ANY
// rosterUnknown as "ignored, all four lenses run" and never read the
// ceiling beside it. Those two decisions disagree.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LENSES, runGate, shipConfigOf } from "../../src/doors/review-gate.ts"

function fixture(where: string): void {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  writeFileSync(join(where, "review-gate.toml"), 'roster = "principles,tests"\n')
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
}

test("INV-4: a valid csv roster must not be reported as all-four while the gate caps to it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-1-"))
  const repo = join(tmp, "repo")
  const prev = process.env.WHL_GATE_LEDGER
  process.env.WHL_GATE_LEDGER = join(tmp, "ledger.jsonl")
  try {
    fixture(repo)
    const cfg = shipConfigOf(repo, { base: "main" })
    const { decision } = runGate(repo, "main", "feat", { jev: false })
    const door = readFileSync(new URL("../../bin/whitehartlane", import.meta.url), "utf8")
    const claimsAllFour = /rosterUnknown[\s\S]{0,400}ALL FOUR lenses are the ceiling/.test(door)
    const narrowed = (cfg.roster ?? [...LENSES]).length < LENSES.length
    assert.equal(
      Boolean(claimsAllFour && cfg.rosterUnknown && cfg.rosterUnknown.length > 0 && narrowed),
      false,
      `INV-4: rosterUnknown=${JSON.stringify(cfg.rosterUnknown)} coexists with ceiling ${JSON.stringify(cfg.roster)} and the door prints "ALL FOUR lenses are the ceiling" whenever unknown is set, but runGate's fail-safe roster is ${JSON.stringify(decision.roster)} — the printed verdict and the universe disagree`,
    )
  } finally {
    if (prev === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prev
    rmSync(tmp, { recursive: true, force: true })
  }
})
