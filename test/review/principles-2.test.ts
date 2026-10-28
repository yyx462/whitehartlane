import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (twin paths — "when is a bad --model refused"): the diff added the
// bare-id refusal at src/doors/review.ts:71, correctly placed BEFORE any
// materialization. The missing-model twin (the same decision, same file,
// review.ts:151-161) still refuses AFTER mkdir+cpSync: the refused dir has
// workflow.toml but no data/review/, so the door's own replace-guard
// (review.ts:134, ours = workflow.toml && data/review) then classifies it
// as "not a materialized review program" — the re-run the refusal message
// itself prescribes ("pass --model <provider/model>") is refused too. The
// recovery from the exact mistake the check exists to catch is dead-ended;
// the user must hand-delete the dir (on the default --out path, a dir
// inside the repo under review). Fails on BASE too (the position is
// pre-existing) — the diff touched this exact decision in this file and
// left the twin wrong: the incomplete-fix class.
test("the door accepts its own prescribed fix for a refused --out dir", () => {
  const repo = mkdtempSync(join(tmpdir(), "whl-p2-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-p2-out-"))
  const out = join(outRoot, "program") // must NOT exist beforehand
  try {
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    mkdirSync(join(repo, "src"), { recursive: true })
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    // 1st run: no --model → the pr-review template pins temperature, so the
    // door must refuse (this half is correct on HEAD and BASE alike)
    const r1 = prepareReview({ repo, base: "master", head: "feat", out }, join(ROOT, "templates"))
    assert.equal(r1.ok, false, "the door must refuse a missing --model when the template pins temperature")
    // 2nd run: EXACTLY the fix the refusal message itself prescribes
    const r2 = prepareReview(
      { repo, base: "master", head: "feat", model: "zhipuai-coding-plan/glm-5.3-flash", out },
      join(ROOT, "templates"),
    )
    assert.equal(
      r2.ok,
      true,
      `INV-3 twin: the missing-model refusal materialized ${out} and THEN refused, leaving workflow.toml ` +
        `without data/review — the door's own replace-guard (review.ts:134) now refuses the re-run its own ` +
        `message prescribed ("pass --model <provider/model>"): r2 why=${(r2 as { why?: string }).why ?? "n/a"}`,
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
