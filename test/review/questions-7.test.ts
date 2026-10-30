import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// QUESTIONS.md #7 / INV-4 (a claim is a measurement) — the diff touches
// tests AND the suite command (package.json: the quoted glob now runs
// every file under test/ on every `npm test`), and its own laws demand
// the result be machine-independent:
//   - test/review/tests-8.test.ts: "`npm test` must be GREEN over
//     everything its own glob now includes"
//   - test/review/tests-9.test.ts (INV-4): "the diff's own README
//     promises ... any machine" — machine-specific behavior is the
//     exact class that law exists to kill.
// The diff's ADOPTED test `writeWorkerPermissions MERGES: pins survive
// the re-seed, isolation force-wins (#249)` (test/store.test.ts:386)
// asserts `oc.mcp["sql-buddy"].enabled === false` — "sql-buddy" is the
// OPERATOR'S global opencode MCP inventory, not a repo fact. On any
// machine whose `opencode mcp list` names a different set (or is slow
// enough to trip the 20s budget in globalMcpNames, which caches the
// miss), oc.mcp carries no sql-buddy key and the adopted test throws —
// `npm test` is red at HEAD for a reason that has nothing to do with
// the repo. Observed live in this review's own sandbox: a cold
// `opencode mcp list` under a 3-file concurrent run left the cache at
// [] and this exact assertion threw (store.test.ts:400). This repro
// makes the machine-dependence DETERMINISTIC: a stub `opencode` on
// PATH lists a different server, and the adopted test file must still
// be green. On HEAD it is red (TypeError at store.test.ts:400); on
// BASE the adopted test does not exist and the file is green.
test("the adopted suite is green on a machine whose global opencode MCP inventory differs", () => {
  const stubBin = mkdtempSync(join(tmpdir(), "whl-q7-bin-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-q7-"))
  try {
    // a legal `opencode mcp list` that names a DIFFERENT machine's set
    writeFileSync(
      join(stubBin, "opencode"),
      "#!/bin/sh\nprintf '%s\\n' '✓ some-other-server  connected'\n",
      { mode: 0o755 },
    )
    // the same trap tests-8 documents: under `node --test`, a spawned
    // runner that inherits NODE_TEST_CONTEXT detects a "recursive" run
    // and exits 0 WITHOUT running the file — a vacuous green
    const innerEnv = { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, SHEP_SCOPE: "whl-test" }
    delete innerEnv.NODE_TEST_CONTEXT
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--test", join(ROOT, "test", "store.test.ts")],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: innerEnv,
        timeout: 120_000,
      },
    )
    assert.equal(
      r.status,
      0,
      `INV-4 (a claim is a measurement; the diff's own any-machine law, tests-9) / QUESTIONS #7: the suite ` +
        `this diff widens must be green on ANY machine. The adopted merge test asserts the operator's global ` +
        `MCP inventory ("sql-buddy") instead of a repo fact, so with a global opencode MCP set that differs ` +
        `(this stub lists some-other-server), test/store.test.ts exits ${r.status} — stderr tail: ` +
        `${(r.stderr ?? "").split("\n").filter(Boolean).slice(-3).join(" | ") || "(none)"} — and \`npm test\`` +
        ` is red at HEAD for a machine fact, not a repo fact. tests-8's own law ("npm test must be green over ` +
        `everything its own glob now includes") is false on every machine whose inventory differs.`,
    )
  } finally {
    rmSync(stubBin, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
