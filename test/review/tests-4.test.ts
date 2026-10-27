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

test("a $-bearing --model is refused at the door; a legal one lands verbatim (not replace-expanded)", () => {
  // the r12 repro expected $-models to LAND (grammar permissive, write
  // pattern-safe) — the tightened grammar is the better end state: a
  // verbatim $& pin still dies four lenses late at provider resolution
  // (the model exists nowhere), so garbage ids refuse at the door and
  // the FUNCTION replacement keeps legal ids pattern-proof.
  for (const model of ["prov/m$&d", "prov/m$1d", "pro$v/m$&d"]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-tests4-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const r = prepareReview({ repo, base: "master", head: "feat", model, out }, join(ROOT, "templates"))
      assert.equal(r.ok, false, `the door refuses ${JSON.stringify(model)} — shell-hostile characters are not model ids`)
      assert.match((r as { why: string }).why, /provider\/model/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
  // a legal id lands VERBATIM through the replace path (pattern-proof)
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests4-legal-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const model = "prov.in-put/m-o.d.el"
    const r = prepareReview({ repo, base: "master", head: "feat", model, out }, join(ROOT, "templates"))
    assert.ok(r.ok, (r as { why?: string }).why)
    const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
    const pin = toml.match(/^model\s*=\s*(.*)$/m)?.[1]
    assert.equal(pin, JSON.stringify(model), "the pin lands verbatim, never replace-pattern-expanded")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
