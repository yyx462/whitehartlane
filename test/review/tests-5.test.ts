import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one decision, one place): "does a model problem block a
// docs-only diff?" is answered TWICE in src/doors/review.ts with
// opposite answers. The missing-model check is placed AFTER the
// docs-only skip with the comment "A docs-only diff never needs a
// model: nothing spawns, nothing pins" (review.ts:134). The
// malformed-model grammar check (review.ts:76) runs BEFORE the skip
// with no such yield — the identical reasoning applies to it (a
// malformed model also only matters when something pins or spawns).
// On BASE a docs-only diff skipped regardless of the model's shape
// (no grammar check existed); on HEAD `whl review <docs-only repo>
// --model claude-sonnet-4` refuses with exit 2 — the help's own hard
// rule "docs-only diffs skip at the door (receipt printed, exit 0)"
// is false for exactly the caller who typo'd their model on a docs PR.
function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(where, { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "README.md"), "base\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "README.md"), "base\nfeat docs change\n")
  g("add", "-A")
  g("commit", "-q", "-m", "docs")
  return where
}

test("a docs-only diff skips even when the --model is malformed, as its twin reasons", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests5-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "claude-sonnet-4", out },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && "skipped" in r && r.skipped,
      `INV-3 twin: the door's missing-model check yields to the docs-only skip ("nothing spawns, ` +
        `nothing pins" — review.ts:134) but the malformed-model check (review.ts:76) does not, so a ` +
        `docs-only diff with a bare --model is refused (ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}) ` +
        `instead of skipping — BASE skipped it, and the help's hard rule promises "docs-only diffs skip ` +
        `at the door (receipt printed, exit 0)". One decision, two opposite answers in one file.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
