import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one decision, one place) + the manual's own hard rule ("--model
// is REQUIRED as provider/model … bare ids are refused"): the new bare-id
// refusal (review.ts:71) guards `if (args.model && …)`, so an EMPTY-string
// --model is treated as "no model given" there — but the moved
// missing-model screen (review.ts:133) counts the same value as a declared
// model (`typeof args.model === "string"`). One decision — "is a model
// declared" — answered two opposite ways inside one function:
// `--model ""` (the classic unset shell var: --model "$WHL_MODEL") sails
// the door and materializes a review whose four temperature-pinned lenses
// cannot spawn (opencode-host.ts:95 refuses each). BASE refused this exact
// input (post-materialization, regex-on-toml only): the diff introduced the
// bypass. QUESTIONS.md #3/#5: every accepted input must reach a consumer.
test("the door refuses an empty --model, not materialize an unspawnable review", () => {
  const repo = mkdtempSync(join(tmpdir(), "whl-q2-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-q2-out-"))
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

    // exactly what `whl review … --model "$WHL_MODEL"` hands the door when
    // the variable is unset: an empty string, not undefined
    const r = prepareReview({ repo, base: "master", head: "feat", model: "", out }, join(ROOT, "templates"))
    const why = (r as { why?: string }).why
    assert.equal(
      r.ok,
      false,
      `INV-3: the door answers "is a model declared" two opposite ways for --model "" — ` +
        `review.ts:71 treats it as none (bare-id guard skipped), review.ts:133 as declared ` +
        `(\`typeof args.model === "string"\`), so the door materialized an unspawnable review ` +
        `(ok=${r.ok}, why=${why ?? "n/a"}). BASE refused this input; the manual's hard rule ` +
        `promises non-provider/model values are refused at the door.`,
    )
    assert.match(
      String(why ?? ""),
      /model/i,
      "the refusal must name the model problem — the fix the message prescribes must be passable",
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
