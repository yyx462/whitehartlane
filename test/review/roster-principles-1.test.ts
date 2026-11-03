// INV-3: "what roster does this contract declare" must have one reader.
// ship-config (bin/whitehartlane ship-config) calls shipConfigOf(repo)
// with NO base/head — the same call shape as the auto/model probe.
// This change prints cfg.roster / cfg.rosterUnknown from that call, but
// the no-commit return never runs parseRosterKey. Silence reads as
// "no ceiling" while the file declares one.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

test("INV-3: ship-config's call shape returns the roster the file declares", () => {
  const tmp = mkdtempSync(join(tmpdir(), "principles-1-"))
  const repo = join(tmp, "repo")
  execSync("git init -q -b main", { cwd: tmp })
  execSync("mkdir -p repo && git init -q -b main repo", { cwd: tmp })
  execSync("git config user.email t@t && git config user.name t", { cwd: repo })
  writeFileSync(join(repo, "review-gate.toml"), 'roster = ["principles", "tests", "questions"]\nstrictness = "strict"\n')
  execSync("git add -A && git commit -qm roster", { cwd: repo })
  try {
    // the exact call ship-config makes (bin/whitehartlane:942)
    const probe = shipConfigOf(repo)
    assert.deepEqual(
      probe.roster,
      ["principles", "tests", "questions"],
      "INV-3: ship-config's reader must see the declared ceiling; an absent roster is a second decision (no ceiling) that disagrees with parseRosterKey",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
