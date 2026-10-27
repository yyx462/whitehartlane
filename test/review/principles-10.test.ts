import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-2 (an accepted field reaches its consumer — refuse, never
// vanish) / INV-3 (one decision, two predicates): "will the model pin
// land in the template's workflow.toml?" is computed TWICE in
// src/doors/review.ts with two different spellings of the header:
//
//   - the pin-verify (review.ts:155, added by this diff to make the
//     landing verified pre-materialization):
//         /^\[workflow\]\s*$/m — accepts "[workflow] " with
//         TRAILING WHITESPACE (\s* eats it) and "[workflow]\r" (a CRLF
//         template — \s* eats the \r).
//   - the pin-write anchor (review.ts:194, the replacement target):
//         /^(\[workflow\])$/m — matches ONLY "[workflow]" followed
//         immediately by end-of-line; a trailing space or \r breaks
//         the match, so String.replace finds nothing, writes the toml
//         back UNCHANGED — and the pin silently vanishes.
//
// The verify's own comment claims the property that fails
// (review.ts:152-154): "the write's outcome is computable from the
// template: the pin lands iff the template has a model line
// (replaced) or a [workflow] header (inserted after). Neither →
// refuse before mkdir." For both shapes below the verify sees the
// header (no refusal, ok:true) while the write lands nothing — the
// door returns SUCCESS with a workflow.toml that keeps its
// temperature pins and NO model. Every lens then dies at spawn
// (src/adapters/opencode-host.ts:95 refuses a temperature spawn with
// no model to ride) — the exact four-lenses-late death this door
// check exists to refuse. A CRLF template is not exotic: any template
// edited on Windows or materialized through a CRLF-converting
// checkout has them. BASE dropped the pin the same way, but BASE made
// no promise; this diff's verify (and its comment) DO — the claim is
// false on HEAD.
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

function laxTemplate(where: string, header: string): string {
  mkdirSync(where, { recursive: true })
  const body = [`name = "p10"`, `worker_kind = "opencode"`, ``, `[[stage]]`, `id = "u"`, `topology = "fan-out"`, `units = [{ id = "a", brief = "b" }]`, ``].join("\n")
  writeFileSync(join(where, "workflow.toml"), header + "\n" + body)
  writeFileSync(join(where, "REVIEWER.md"), "# reviewer law\n")
  writeFileSync(join(where, "SCHEMA.md"), "# schema\n")
  writeFileSync(join(where, "INVARIANTS.template.md"), "# invariants seed\n")
  writeFileSync(join(where, "QUESTIONS.template.md"), "# questions seed\n")
  return where
}

test("the pin-verify and the pin-write agree on where the model pin can land", () => {
  const shapes: [string, string][] = [
    ["a [workflow] header with trailing whitespace", "[workflow] "],
    ["a CRLF [workflow] header (a Windows-edited template)", "[workflow]\r"],
  ]
  for (const [label, header] of shapes) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p10-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const tpl = laxTemplate(join(tmp, "tpl"), header)
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `sanity: the verify must ACCEPT ${label} (the header is present — a refusal would be the other bug); got: ${JSON.stringify(r)}`,
      )
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.match(
        toml,
        /^model = "acme\/strong"$/m,
        `INV-2/INV-3: the model pin must land wherever the verify said it would. For ${label}, the ` +
          `pin-verify (review.ts:155, /^\\[workflow\\]\\s*$/m) ACCEPTED the header — so the door returned ok:true ` +
          `— while the pin-write anchor (review.ts:194, /^(\\[workflow\\])$/m) matched NOTHING: String.replace ` +
          `found no "[workflow]" at end-of-line (trailing whitespace/CR sits between ] and the newline) and wrote ` +
          `the toml back unchanged. The materialized workflow.toml carries NO model pin ` +
          `(model line present: ${/^model\s*=/m.test(toml)}) — the door kept its temperature pins and shipped a ` +
          `program whose four lens spawns each refuse at opencode-host.ts:95, the four-lenses-late death the ` +
          `verify's own comment (review.ts:152-154, "the pin lands iff … a [workflow] header") promises cannot ` +
          `happen. One decision — "will the pin land?" — two predicates that disagree; refuse, never vanish.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
