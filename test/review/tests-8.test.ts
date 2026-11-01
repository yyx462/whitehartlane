import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { globSync } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// The diff edits the one suite command (package.json "test"): the glob
// moves from SHELL expansion (unquoted `test/**/*.test.ts` — under sh,
// ** degrades to * and the pattern reaches only one dir deep, so the
// ~87 top-level and deep test files NEVER ran under `npm test`) to
// NODE's own glob (quoted — ** matches zero+ dirs, the whole suite
// runs). The widening is the right instinct, but it is load-bearing
// the moment it lands: `npm test` must be GREEN over everything its
// own glob now includes. It is not — test/web-canvas-fit.test.ts (2
// failing assertions, red on BASE's tree too, pre-existing debt that
// the old glob silently skipped) now runs on every `npm test` and
// fails: the suite command this change owns exits nonzero on HEAD and
// zero on BASE. A change that widens what the suite runs ships either
// a green suite or a named exclusion — not a red `npm test`.
test("npm test is green over the files its own glob newly includes", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const script = String(pkg.scripts?.test ?? "")
  // BASE shape: the glob rides unquoted — the shell expands it, top-level
  // files never run, nothing was widened, nothing to prove here
  const quoted = script.match(/--test\s+"([^"]+)"\s*$/)
  if (!quoted) return
  const pattern = quoted[1]
  const included = globSync(pattern).map((p) => String(p)).sort()
  const canary = "test/web-canvas-fit.test.ts"
  assert.ok(
    included.includes(canary),
    `sanity: the quoted glob ${pattern} must actually widen the suite to include ${canary} (got ${included.length} files)`,
  )
  // this test itself runs under `node --test`; without stripping
  // NODE_TEST_CONTEXT the spawned runner detects a "recursive" run and
  // exits 0 WITHOUT running the file — a vacuous green
  const innerEnv = { ...process.env, SHEP_SCOPE: "whl-test" }
  delete innerEnv.NODE_TEST_CONTEXT
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--test", canary], {
    cwd: ROOT,
    encoding: "utf8",
    env: innerEnv,
  })
  const fails = [...run.stdout.matchAll(/^✖ (.+)$/gm)].map((m) => m[1])
  assert.equal(
    run.status,
    0,
    `INV-4: the diff's own edit of the suite command (package.json:36, quoted "test/**/*.test.ts") ` +
      `widens \`npm test\` from the shell's ${"one-dir-deep"} 18 files to node's ${included.length}-file suite, ` +
      `and the widened suite is RED: ${canary} fails (${fails.length} assertions: ${fails.slice(0, 2).join(" | ")}) — ` +
      `\`npm test\` exits ${run.status} on HEAD and 0 on BASE (the old glob never ran these files). ` +
      `A change that widens what the suite runs ships a green suite or a named exclusion, not a red command.`,
  )
})
