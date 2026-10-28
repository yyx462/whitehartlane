import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (the suite's green is a verdict) — this diff edits the one
// suite command (package.json:36) and its own tests-8 states the law:
// "a change that widens what the suite runs ships either a green suite
// or a named exclusion — not a red `npm test`". On HEAD as reviewed,
// the widened suite is RED: test/review/questions-3.test.ts ("the
// booking probe does not orphan a running Job whose pid answers
// EPERM") fails — a proven, unaddressed fault in the diff's own
// booking probe, riding inside the suite the diff declares must be
// green. No exclusion names it. This repro runs that file the way
// `npm test` runs it and demands exit 0; it fails on HEAD and is
// vacuous on BASE (the file does not exist there — the repro, and the
// redness, arrived with this change's review loop).
test("the suite this diff widens is green — every file its glob runs exits 0", () => {
  const red = join(ROOT, "test", "review", "questions-3.test.ts")
  if (!existsSync(red)) return // BASE shape: the repro is not in the tree — nothing to prove
  // this test runs under `node --test`; strip NODE_TEST_CONTEXT so the
  // spawned runner actually executes the file (tests-8's receipt)
  const innerEnv = { ...process.env, SHEP_SCOPE: "whl-test" }
  delete innerEnv.NODE_TEST_CONTEXT
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", red], {
    cwd: ROOT,
    encoding: "utf8",
    env: innerEnv,
  })
  const fails = [...run.stdout.matchAll(/^✖ (.+)$/gm)].map((m) => m[1])
  assert.equal(
    run.status,
    0,
    `INV-4/tests-8's own law: the diff widens \`npm test\` (package.json:36, quoted "test/**/*.test.ts") ` +
      `and states "a change that widens what the suite runs ships either a green suite or a named ` +
      `exclusion — not a red npm test". HEAD ships red with no exclusion: ${red} exits ${run.status} ` +
      `(${fails.length} failing: ${fails.slice(0, 2).join(" | ") || "see output"}) — a proven fault in the ` +
      `diff's own booking probe (EPERM misread as death, the store.ts pidAlive twin), unaddressed and ` +
      `unexcluded, inside the very suite the diff makes load-bearing.`,
  )
})
