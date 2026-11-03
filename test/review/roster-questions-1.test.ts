import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

// INV-2 / the change's own claim: ship-config is the working-tree
// reader's one seat (bin/whitehartlane ship-config calls
// shipConfigOf(repo) with no commit). The new print reads cfg.roster.
// A roster committed on the checkout HEAD must surface — otherwise the
// probe omits the ceiling the file declares.
test("shipConfigOf() without a commit surfaces the working-tree roster (ship-config's call)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q1-roster-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "review-gate.toml"), 'roster = ["principles", "tests", "questions"]\nstrictness = "strict"\n')
  g("add -A")
  g("commit -qm roster")
  try {
    const cfg = shipConfigOf(repo)
    assert.deepEqual(
      cfg.roster,
      ["principles", "tests", "questions"],
      "INV-2: the roster field the parser accepts must reach ship-config's reader (shipConfigOf with no commit)",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
