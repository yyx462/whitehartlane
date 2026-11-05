// INV-2: the roster key this diff adds must reach the one external
// reader. `whl ship-config` calls shipConfigOf(repo) with no base/head
// (bin/whitehartlane ship-config) and prints cfg.roster /
// cfg.rosterUnknown. The commit path runs parseRosterKey; the no-commit
// return does not — the printer is silent, which reads as "no ceiling".
import assert from "node:assert/strict"
import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("tests-1: ship-config's call must surface a committed roster, not report the ceiling as absent (INV-2)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tests-1-roster-"))
  const repo = join(tmp, "repo")
  execSync("git init -q -b main repo", { cwd: tmp })
  execSync("git config user.email t@t.local && git config user.name t", { cwd: repo })
  writeFileSync(join(repo, "review-gate.toml"), 'auto = true\nroster = ["momentum", "principles", "tests"]\nstrictness = "strict"\n')
  execSync("git add -A && git commit -qm roster", { cwd: repo })
  try {
    // twin: the commit seat sees it (LENSES order, not declaration order)
    const trusted = shipConfigOf(repo, { base: "main" })
    assert.deepEqual(trusted.roster, ["principles", "tests", "momentum"], "sanity: the base commit parses the key")
    // the seat the printer actually calls
    const probe = shipConfigOf(repo)
    assert.deepEqual(
      probe.roster,
      ["principles", "tests", "momentum"],
      "INV-2: roster accepted on the commit path must reach shipConfigOf() with no commit — the call whl ship-config makes — not vanish",
    )
    const out = execFileSync(process.execPath, ["--experimental-strip-types", BIN, "ship-config", repo], {
      encoding: "utf8",
    })
    assert.match(
      out,
      /roster: principles,tests,momentum/,
      `INV-2: ship-config must print the declared ceiling; silence is a second decision (no ceiling). got:\n${out}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
