import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

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

// INV-3 (twin refusal sites — "must a refusal leave the recovery its own
// message prescribes alive?"). This diff FIXED the missing-model refusal
// for exactly this disease: review.ts:133-149 refuses BEFORE mkdir+cpSync,
// with the comment citing the #251 review's principles-2 ("it used to fire
// after mkdir+cpSync, leaving a half-built dir the replace-guard then
// refused to replace — the recovery the message itself prescribed was
// dead-ended"). The SAME diff then added a NEW post-materialization
// refusal, the pin-verify at review.ts:186-192 (the r15 tests-1 INV-2
// fix), which fires AFTER mkdir+cpSync (review.ts:165-166) but BEFORE
// data/review is written (review.ts:211). A refused dir therefore holds
// workflow.toml and NO data/review — the door's own replace-guard
// (review.ts:158-163: ours = workflow.toml && data/review) classifies it
// as "not a materialized review program" and refuses the re-run that the
// verify's message prescribes ("add a [workflow] table to the template,
// or pass --template pointing at one"). The recovery is dead-ended; the
// user must hand-delete a dir inside the repo under review (the default
// --out is repo/.whl-review/<slug>). One decision — "refuse before
// materializing" — answered correctly at review.ts:133 and wrongly at
// review.ts:186, in the same function, by the same change: the
// incomplete-fix class. (Contrast the --body-file refusal at
// review.ts:216, which fires after data/review exists and so re-runs
// fine — the file knows the rule.)
test("the pin-verify refusal leaves the recovery its own message prescribes alive", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-m9-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program") // must NOT exist beforehand
    // a template whose workflow.toml has neither a model line nor a
    // [workflow] header — the only shape that reaches the new verify
    // (reachable via the first-class --template flag)
    const tmpl = join(tmp, "tmpl", "pr-review")
    cpSync(join(ROOT, "templates", "pr-review"), tmpl, { recursive: true })
    writeFileSync(
      join(tmpl, "workflow.toml"),
      readFileSync(join(tmpl, "workflow.toml"), "utf8").replace(/^\[workflow\]\s*$/m, "[workflow-removed]"),
    )

    const args = { repo, base: "master", head: "feat", model: "acme/strong", out, template: tmpl }
    // run 1: the door refuses — the pin has nowhere to land
    const r1 = prepareReview(args, join(ROOT, "templates"))
    if (r1.ok) return // BASE shape: no pin-verify refusal (the model silently vanishes) — nothing to prove here
    assert.match(
      (r1 as { why: string }).why,
      /no \[workflow\] table/,
      "sanity: HEAD refuses via the new pin-verify",
    )

    // the refusal's own prescribed fix: "add a [workflow] table to the
    // template, or pass --template pointing at one" — do exactly that
    writeFileSync(
      join(tmpl, "workflow.toml"),
      readFileSync(join(tmpl, "workflow.toml"), "utf8").replace("[workflow-removed]", "[workflow]"),
    )

    // run 2 at the SAME --out: the door must accept its own prescribed fix
    const r2 = prepareReview(args, join(ROOT, "templates"))
    assert.equal(
      r2.ok,
      true,
      `INV-3: the pin-verify refusal (review.ts:186) materialized ${out} (mkdir+cpSync at review.ts:165-166) and ` +
        `THEN refused, leaving workflow.toml without data/review — the door's own replace-guard (review.ts:158-163, ` +
        `ours = workflow.toml && data/review) now refuses the re-run the refusal's message prescribes ` +
        `("add a [workflow] table to the template, or pass --template pointing at one"): r2 ok=${String(r2.ok)}, ` +
        `why=${r2.ok ? "n/a" : (r2 as { why?: string }).why}. The half-built-dir dead-end this diff's own comment ` +
        `records as fixed (review.ts:133-149, the principles-2 receipt) is reintroduced by the new refusal 50 lines below it. ` +
        `The diff touched this exact decision in this exact file and left the new site wrong: the incomplete-fix class.`,
    )
    // and the accepted fix must actually materialize a review program
    assert.ok(
      r2.ok && existsSync(join(out, "data", "review", "config.sh")),
      "sanity: the accepted re-run materializes the program (data/review/config.sh exists)",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
