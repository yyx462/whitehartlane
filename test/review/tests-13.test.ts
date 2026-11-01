import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-2's own recovery law (the diff's comment at review.ts:133-137,
// quoting the #251 review's principles-2): a refusal that fires AFTER
// mkdir+cpSync "leav[es] a half-built dir the replace-guard then
// refused to replace — the recovery the message itself prescribed was
// dead-ended". The diff moved the missing-model refusal BEFORE
// materialization to honor that law — then ADDED a new refusal that
// violates it: the pin-verify refusal (review.ts:186-192, "the
// template's workflow.toml has no [workflow] table … add a [workflow]
// table to the template, or pass --template pointing at one") fires
// after cpSync and leaves the materialized dir WITH workflow.toml but
// WITHOUT data/review (created later, review.ts:211). The door's own
// replace-guard (review.ts:158-161: ours = workflow.toml && data/review)
// then classifies the leftover as "not a materialized review program"
// and refuses the re-run the message itself prescribes (fixed template,
// same --out). The user must hand-delete a dir that, on the default
// --out path, sits INSIDE the repo under review (.whl-review/<slug>).
// The incomplete-fix class, re-introduced by this change at a new site.
//
// On BASE this repro is vacuous by construction: BASE had no pin-verify
// (the pin silently vanished with ok:true — the INV-2 hole the diff
// fixes), so the guarded scenario never arises.
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

function templateDir(where: string, withWorkflowHeader: boolean): string {
  mkdirSync(where, { recursive: true })
  const head = withWorkflowHeader ? ["[workflow]", `name = "t13"`, `worker_kind = "opencode"`, ""] : [`name = "t13"`, `worker_kind = "opencode"`, ""]
  writeFileSync(
    join(where, "workflow.toml"),
    [...head, "[[stage]]", `id = "u"`, `topology = "fan-out"`, `units = [{ id = "a", brief = "b" }]`, ""].join("\n"),
  )
  writeFileSync(join(where, "REVIEWER.md"), "# reviewer law\n")
  writeFileSync(join(where, "SCHEMA.md"), "# schema\n")
  writeFileSync(join(where, "INVARIANTS.template.md"), "# invariants seed\n")
  writeFileSync(join(where, "QUESTIONS.template.md"), "# questions seed\n")
  return where
}

test("the pin-verify refusal's own prescribed fix is accepted, not dead-ended by the replace-guard", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests13-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const bad = templateDir(join(tmp, "tpl-bad"), false)

    // run 1: the door must refuse (the INV-2 verify the diff added) —
    // and the refusal fires PRE-materialization: nothing lands in
    // --out, so the half-built dir (workflow.toml without data/review)
    // — the dead-end shape this repro was written to catch — cannot
    // arise at all
    const r1 = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: bad },
      join(ROOT, "templates"),
    )
    if (r1.ok) return // BASE shape: no pin-verify, the model silently vanished — this repro judges the HEAD refusal's recovery
    assert.equal((r1 as { code?: number }).code, 2, "the pin-verify refusal must be a code-2 door refusal")
    assert.match((r1 as { why?: string }).why ?? "", /no \[workflow\] table/, "the refusal must name the fix")

    // the mechanism, INVERTED by the fix: the refusal leaves NOTHING
    // behind (the old post-cpSync refusal left workflow.toml without
    // data/review — the replace-guard's "not ours" dead-end)
    assert.ok(
      !existsSync(join(out, "workflow.toml")),
      "the pre-materialization refusal must leave nothing in --out — no half-built dir may dead-end the prescribed fix",
    )

    // run 2: EXACTLY the fix the refusal message prescribes — the
    // template now carries a [workflow] table, same --out
    const good = templateDir(join(tmp, "tpl-good"), true)
    const r2 = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: good },
      join(ROOT, "templates"),
    )
    assert.equal(
      r2.ok,
      true,
      `INV-2's recovery law (the diff's own comment at review.ts:133-137): a post-materialization refusal ` +
        `dead-ends its prescribed fix — review.ts:186-192 refuses AFTER mkdir+cpSync and leaves a dir with ` +
        `workflow.toml but no data/review, so the replace-guard (review.ts:158-161) refuses the re-run the ` +
        `message itself prescribes ("add a [workflow] table … or pass --template pointing at one"): ` +
        `r2.ok=${String(r2.ok)}, why=${(r2 as { why?: string }).why ?? "n/a"}. The user must hand-delete a ` +
        `dir that on the default --out sits inside the repo under review. The diff moved the missing-model ` +
        `refusal pre-materialization for exactly this reason (principles-2) and then added a new refusal ` +
        `with the same disease.`,
    )
    if (r2.ok) {
      assert.match(
        readFileSync(join((r2 as { dir: string }).dir, "workflow.toml"), "utf8"),
        /^model = "acme\/strong"$/m,
        "the recovered materialization must carry the pin (the fix lands whole)",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
