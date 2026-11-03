import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

// The contract's own law (review-gate.toml, ShipConfig comment): an
// absent roster key is no contract — all four lenses, not a typo. The
// door prints rosterUnknown as "unknown lens ids". String(undefined)
// must not land there.
test("principles-1: absent roster key is not an unknown id (INV-4)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-absent-roster-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
  // a real contract with no roster key — this repo's own shape
  writeFileSync(join(repo, "review-gate.toml"), 'auto = true\nmodel = "minimax-cn/MiniMax-M3.1-Flash"\nstrictness = "strict"\n')
  g("add -A")
  g("commit -qm base")
  try {
    const trusted = shipConfigOf(repo, { base: "main" })
    const probe = shipConfigOf(repo)
    assert.equal(trusted.roster, undefined, "INV-4: absent roster is all four, not a ceiling")
    assert.equal(
      trusted.rosterUnknown,
      undefined,
      `INV-4: absent roster key reported as a typo — rosterUnknown=${JSON.stringify(trusted.rosterUnknown)} (door prints this as unknown lens ids)`,
    )
    assert.equal(
      probe.rosterUnknown,
      undefined,
      `INV-4: ship-config probe also reports absence as a typo — rosterUnknown=${JSON.stringify(probe.rosterUnknown)}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
