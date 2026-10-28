import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { parse as parseToml } from "smol-toml"

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

// INV-2 / INV-4: the pin-plan's landing anchor (src/doors/review.ts
// pinIntoWorkflowTable) has two blind spots that make it refuse a
// template the run-time reads fine, with a refusal whose PREMISE is
// false ("the template's workflow.toml has no [workflow] table"):
//
//   1. the header matcher `/^\[workflow\][ \t]*$/` (on l.trim()) only
//      recognizes a [workflow] header ALONE on its line — but TOML
//      allows a comment after any table header, and smol-toml (the
//      consumer) parses "[workflow] # knobs" into a working [workflow]
//      table. The r17 fix taught the anchor trailing WHITESPACE
//      (principles-10); a trailing comment is the same class one token
//      later.
//   2. the table-span end detector `/^\[[^\]]*\][ \t]*$/` cannot match
//      an ARRAY-OF-TABLES header ("[[stage]]" leaves a trailing ]),
//      verified: the regex answers false for "[[stage]]". The span
//      therefore overshoots every [[stage]] block and the "first model
//      line in the table" scan can reach a `model =` line inside a
//      later [[stage]] table — the pin replaces THAT line (the stage's
//      own key), the verify's parse then reads workflow.model undefined
//      and the door refuses a template that HAS a [workflow] table the
//      insert branch was one line from serving.
//
// In both shapes loadManifest/smol-toml — the consumer the verify
// claims to speak for ("the verification is the consumer's own read") —
// reads the template's [workflow] table perfectly. Refuse only when the
// consumer truly cannot read the landing; a false-premise refusal is
// INV-4's dishonest-verdict class at the door.
const SHAPES: [string, (tplToml: string) => string][] = [
  [
    "a [workflow] header with a trailing comment (legal TOML the consumer parses)",
    (t) => t.replace(/^\[workflow\][ \t]*$/m, "[workflow] # the run's shared knobs"),
  ],
  [
    "a model line inside a [[stage]] block (the span end cannot see array-of-tables headers)",
    (t) =>
      t.replace(
        /^(\[\[stage\]\]\nid = "intake"\ntopology = "gate")$/m,
        `$1\nmodel = "old/stage-default"`,
      ),
  ],
]

test("the door never refuses a template whose [workflow] table the consumer reads", () => {
  for (const [label, mutate] of SHAPES) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t31-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      writeFileSync(
        join(tpl, "workflow.toml"),
        mutate(
          readFileSync(join(ROOT, "templates", "pr-review", "workflow.toml"), "utf8"),
        ),
      )
      for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
        writeFileSync(join(tpl, doc), "# seed\n")
      }

      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
        join(ROOT, "templates"),
      )
      if (r.ok) continue // accepted: this repro's claim (no false refusal) holds; landing is tests-23's class
      // the door refused — the refusal is honest only if the consumer truly
      // cannot read a [workflow] table in the template. Parse the template
      // the way the run-time does: if workflow exists there, the refusal's
      // premise is false.
      let consumerSeesWorkflow: unknown
      try {
        consumerSeesWorkflow = (parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as { workflow?: unknown }).workflow
      } catch {
        consumerSeesWorkflow = undefined
      }
      assert.ok(
        consumerSeesWorkflow === undefined,
        `INV-2/INV-4: the door refused a template its own consumer reads fine: ok=${String(r.ok)}, ` +
          `why=${(r as { why?: string }).why ?? "n/a"}. Shape: ${label}. The template's [workflow] table ` +
          `parses under the same smol-toml the run-time uses (workflow present: ` +
          `${JSON.stringify(consumerSeesWorkflow !== undefined)}), yet the refusal states "the template's ` +
          `workflow.toml has no [workflow] table" — a false premise. Shape 1: the header anchor cannot see a ` +
          `comment after the header. Shape 2: the span-end detector (/^\\[[^\\]]*\\]$/) cannot match ` +
          `"[[stage]]" (array-of-tables), so the model-line scan overshoots into a [[stage]] block, replaces ` +
          `the stage's own model line, and the verify then reads workflow.model undefined. Either way a ` +
          `review never materializes for a template the run path itself accepts. Refuse only when the ` +
          `consumer truly cannot read the landing.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
