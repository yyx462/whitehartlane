// Absent roster key (the documented default: empty/absent = all four)
// must not be reported as the unknown id "undefined". parseRosterKey's
// non-array arm does String(undefined) and the door prints a typo the
// file never wrote.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

test("INV-4: omitted roster key is no contract, not unknown id 'undefined'", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests-1-absent-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "review-gate.toml"), 'auto = true\nmodel = "acme/strong"\nstrictness = "strict"\n')
  g("add -A")
  g("commit -qm base")
  try {
    const cfg = shipConfigOf(repo, { base: "main" })
    assert.equal(cfg.roster, undefined, "INV-4: absent roster is no ceiling")
    assert.equal(
      cfg.rosterUnknown,
      undefined,
      `INV-4: an omitted roster key is not an unknown id — got rosterUnknown=${JSON.stringify(cfg.rosterUnknown)}; the door would print a typo the file did not write`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
