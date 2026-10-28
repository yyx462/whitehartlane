import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// Pins the door's --model format decision end to end (the regex the
// diff added at src/doors/review.ts:71) with the Meta-ACH edges, and
// the kept half of the refactor (the pin still lands). Unlike the
// diff's own momentum-2 (which early-returns when the manual is
// absent), these assertions have no guard: revert the refusal and
// these fail — the adoption bar.
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

test("the door refuses every malformed --model shape, before materializing", () => {
  const bad = [
    " ", // whitespace only — truthy, regex must catch it (BASE wrote model = " " and shipped it)
    "\t",
    "claude-sonnet-4", // bare id — the manual's own hard rule
    "acme/strong extra", // internal whitespace after the slash
    "acme//strong", // two slashes
    "acme/", // empty id
    "/strong", // empty provider
    "acme/strong ", // trailing space
    " acme/strong", // leading space
  ]
  for (const model of bad) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-tests2-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const r = prepareReview({ repo, base: "master", head: "feat", model, out }, join(ROOT, "templates"))
      assert.ok(!r.ok, `--model ${JSON.stringify(model)} must be refused, got ${JSON.stringify(r)}`)
      assert.equal((r as { code?: number }).code, 2, `refusal for ${JSON.stringify(model)} must be code 2`)
      assert.match((r as { why?: string }).why ?? "", /provider\/model/, `refusal for ${JSON.stringify(model)} must name the fix`)
      assert.ok(!existsSync(out), `the refusal for ${JSON.stringify(model)} must leave no materialized dir (the diff's pre-materialization guarantee)`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})

test("a well-formed --model still lands as the workflow pin (the kept half of the refactor)", () => {
  for (const model of ["acme/strong", "zhipuai-coding-plan/glm-5.3-flash", "Provider/Model-1.0"]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-tests2-ok-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const r = prepareReview({ repo, base: "master", head: "feat", model, out }, join(ROOT, "templates"))
      assert.ok(r.ok && !("skipped" in r && r.skipped), `--model ${JSON.stringify(model)} must materialize, got ${JSON.stringify(r)}`)
      assert.match(
        readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8"),
        new RegExp(`^model = "${model.replace(/[.\\/]/g, "\\$&")}"$`, "m"),
        `the pin must carry the model verbatim`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
