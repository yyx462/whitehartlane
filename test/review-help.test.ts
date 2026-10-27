import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

// `whl review --help` must say the spell, not die treating the flag as
// a repo path (the receipt: it errored "…/--help is not a git
// repository" — a CLI that cannot say its own spell is not a CLI).
test("review --help prints the manual and exits 0", () => {
  const out = execFileSync(process.execPath, ["bin/whitehartlane", "review", "--help"], {
    encoding: "utf8",
    env: { ...process.env, AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME },
  })
  assert.match(out, /adversarial pre-merge rail/)
  assert.match(out, /--base <ref>/)
  assert.match(out, /re-levy the SAME\s+program dir/)
  assert.match(out, /ECONOMICS\.md/)
  assert.doesNotMatch(out, /not a git repository/)
})
