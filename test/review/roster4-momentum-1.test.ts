import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

// INV-4: a review-gate.toml that omits roster (the documented default —
// "empty/absent = all four") must not be reported as an unknown id.
// parseRosterKey treats a missing key (undefined) as the scalar offender
// "undefined", so the door's loud line fires on every review of a repo
// that simply declared no ceiling.
test("INV-4: absent roster key is no contract, not unknown id 'undefined'", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-momentum-absent-roster-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(
    join(repo, "review-gate.toml"),
    'auto = true\nmodel = "minimax-cn/MiniMax-M3.1-Flash"\nstrictness = "strict"\n',
  )
  g("add -A")
  g("commit -qm base")
  try {
    const cfg = shipConfigOf(repo, { base: "main" })
    assert.equal(cfg.roster, undefined, "INV-4: absent roster is no ceiling, all four by definition")
    assert.equal(
      cfg.rosterUnknown,
      undefined,
      "INV-4: an omitted roster key is not an unknown id — the door must not report a typo the file did not write",
    )
    const probe = shipConfigOf(repo)
    assert.equal(
      probe.rosterUnknown,
      undefined,
      "INV-4: ship-config (no-commit reader) must not print UNKNOWN IDS for a contract that never named roster",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
