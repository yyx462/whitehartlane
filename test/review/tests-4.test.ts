import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-2 (an accepted field reaches its consumer intact — refuse, never
// mangle): the door's grammar `/^[^\s/]+\/[^\s/]+$/` ACCEPTS model ids
// containing `$` (`$` is neither whitespace nor a slash), and the help's
// hard rule promises such values are either refused at the door or land
// as the workflow pin. The pin write (src/doors/review.ts:171) however
// interpolates `JSON.stringify(args.model)` as the REPLACEMENT argument
// of String.replace — where `$&` (whole match) and `$1` (capture group)
// are replacement-pattern tokens, not literals. A grammar-legal model
// like `prov/m$&d` is therefore accepted, then written CORRUPTED into
// workflow.toml (`$&` expands to the matched `[workflow]` header), so
// the lenses spawn against a model id that exists nowhere — the exact
// four-lenses-late provider death the door check claims to have moved
// "here, at the door". The diff's own tests-2 asserts the verbatim pin
// only for tame ids (`[.\\/]` classes); `$` was never tried.
function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

test("a $-bearing --model lands verbatim (the canonical grammar + pattern-safe write); a bare id refuses", () => {
  // the canonical grammar is /^[^/\s]+\/[^/\s]+$/ — the same decision
  // hooks.ts (×2), coworker.ts and jev/model-ladder.ts make (r14
  // momentum-7/principles-6: my stricter outlier refused colon-bearing
  // ids like ollama/qwen3:32b). $-bearing ids therefore LAND — and
  // they land VERBATIM because the pin write is a function replacement
  // (r12 tests-4's core: a string replacement would expand $&/$1).
  // A bare id (no slash) still refuses at the door, as the manual says.
  for (const model of ["prov/m$&d", "prov/m$1d", "pro$v/m$&d", "ollama/qwen3:32b"]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-tests4-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const r = prepareReview({ repo, base: "master", head: "feat", model, out }, join(ROOT, "templates"))
      assert.ok(r.ok, `the canonical grammar accepts ${JSON.stringify(model)} (got ${(r as { why?: string }).why})`)
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      const pin = toml.match(/^model\s*=\s*(.*)$/m)?.[1]
      assert.equal(
        pin,
        JSON.stringify(model),
        `the pin must land verbatim, never replace-pattern-expanded (got ${pin})`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests4-legal-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview({ repo, base: "master", head: "feat", model: "claude-sonnet-4" }, join(ROOT, "templates"))
    assert.equal(r.ok, false, "a bare id refuses")
    assert.match((r as { why: string }).why, /provider\/model/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
