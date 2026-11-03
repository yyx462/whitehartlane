import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

// INV-2 / the roster contract: an absent roster key is "no contract"
// (all four lenses, no loud refusal). parseRosterKey(undefined) must
// not surface the string "undefined" as an unknown lens id.
test("absent roster key is no contract — not an unknown id named undefined", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q1-absent-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
  // a real contract, roster key ABSENT — this repo's own review-gate.toml shape
  writeFileSync(join(repo, "review-gate.toml"), 'auto = true\nmodel = "x"\nstrictness = "strict"\n')
  g("add -A")
  g("commit -qm base")
  try {
    const base = shipConfigOf(repo, { base: "main" })
    assert.equal(base.roster, undefined, "INV-2: absent roster is no ceiling, not a vanished field")
    assert.equal(
      base.rosterUnknown,
      undefined,
      "INV-2: absent roster must not be reported as unknown id 'undefined' — the door would refuse loudly on every review of a project that declared no ceiling",
    )
    const local = shipConfigOf(repo)
    assert.equal(local.rosterUnknown, undefined, "INV-2: ship-config (no-commit reader) has the same absent-key contract")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
