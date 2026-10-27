import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (twin decisions — "did the caller give a model?"): the door
// judges the same args.model value with two different truthiness
// rules. The missing-model refusal counts an empty string as GIVEN
// (review.ts:133 `typeof args.model === "string"`), while the grammar
// check (review.ts:71) and the pin write (review.ts:163) count it as
// ABSENT (`if (args.model)`). `whl review … --model "$WHL_MODEL"` with
// the variable unset hands the door "" — the door materializes a
// program whose four lens spawns each refuse at birth (temperature
// pins, no model to ride: opencode-host.ts:95), exactly the
// four-lenses-late death the door check was built to prevent. BASE
// refused "" (its else branch caught every falsy model); the move to
// pre-materialization introduced the hole.
test("the door refuses an empty --model as loudly as a missing one", () => {
  const repo = mkdtempSync(join(tmpdir(), "whl-p1-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-p1-out-"))
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

    // the shell accident: --model "$WHL_MODEL" with WHL_MODEL unset
    const r = prepareReview({ repo, base: "master", head: "feat", model: "", out }, join(ROOT, "templates"))
    assert.equal(
      r.ok,
      false,
      `INV-3 twin truthiness: review.ts:133 counts model:"" as given (skips the missing-model refusal) while ` +
        `review.ts:71/163 count it as absent (no grammar check, no pin written) — the door materialized a ` +
        `program with temperature pins and NO model, so every lens spawn refuses at birth (r.ok=${String(r.ok)}, ` +
        `why=${(r as { why?: string }).why ?? "materialized instead of refused"})`,
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
