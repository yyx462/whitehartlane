import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard: the pin-verify (the refusal this repro judges) is
// this diff's own addition — on BASE the door materialized --model
// without a landing check, so the false-premise refusal cannot exist
// there (vacuous green on the ok===true assertion).
const doorVerifiesPin = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("pinIntoWorkflowTable")

function fixtureRepo(where: string): string {  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
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

// The template carries a DOCUMENTATION string that quotes a workflow
// example — a multi-line basic string whose interior line is exactly
// `[workflow]` — BEFORE the real [workflow] table. Legal TOML; the
// run-time's own parser (smol-toml, the read the pin-verify claims to
// speak for) parses string content as string content: exactly ONE
// workflow table, the real one.
function templateDir(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[notes]",
      "readme = \"\"\"",
      "This template's program shape (example, not live config):",
      "[workflow]",
      'name = "quoted-example"',
      "\"\"\"",
      "",
      "[workflow]",
      `name = "t5003"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [`,
      `  { id = "principles", temperature = 0.2, brief = "p" },`,
      `  { id = "tests", temperature = 0.4, brief = "t" },`,
      `]`,
      "",
    ].join("\n"),
  )
  return where
}

// INV-2/INV-4 / the door's own adopted law (tests-31, tests-41,
// tests-3001: "the door never refuses a template whose [workflow]
// table the consumer reads — refuse only when the consumer truly
// cannot read the landing"). pinIntoWorkflowTable's header matcher
// (/^\[\s*["']?workflow["']?\s*\]\s*(#.*)?$/ on each raw line) is
// STRING-BLIND: the same string-blindness this diff's own gate-r19
// work named and killed for the units strip ("string content never
// becomes parse data", tests-9101) — but the pin arm never got the
// treatment. The quoted `[workflow]` line inside the documentation
// string matches first, the pin is inserted INSIDE the string value,
// the verify parse reads no workflow.model, and prepareReview refuses
// with "the template's workflow.toml has no [workflow] table the door
// can pin text-preservingly" — a FALSE premise: smol-toml parses a
// real, pin-able [workflow] table from these bytes (pinned below).
// On BASE the same call materialized; the refusal is introduced here.
test("the door never refuses a template whose quoted `[workflow]` line lives inside a documentation string", () => {
  if (!doorVerifiesPin) return // BASE: no pin landing/verify — the door materialized with the pin vanished (a silent hole), nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-t5003-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateDir(join(tmp, "tpl"))

    // premise: the consumer's own read — smol-toml parses the string
    // as a string, and the REAL workflow table is the only one
    const parsedTpl = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      notes?: { readme?: string }
      workflow?: { name?: string }
    }
    assert.ok(
      typeof parsedTpl.notes?.readme === "string" && parsedTpl.notes.readme.includes("[workflow]"),
      "premise: the [workflow] line is string content inside the notes table",
    )
    assert.equal(
      parsedTpl.workflow?.name,
      "t5003",
      "premise: smol-toml reads exactly one workflow table — the real one — from these bytes",
    )

    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    const falsePremise =
      !r.ok && /no \[workflow\] table/.test(String((r as { why?: string }).why ?? ""))
    assert.ok(
      !falsePremise,
      `INV-2/INV-4 (a refusal's premise must survive the consumer's own read; tests-31/tests-41/tests-3001's ` +
        `adopted law — "refuse only when the consumer truly cannot read the landing"): the template quotes a ` +
        `\`[workflow]\` example inside a documentation string, and pinIntoWorkflowTable's header matcher — ` +
        `string-blind, the same class gate-r19 fixed for the units strip ("string content never becomes parse ` +
        `data", tests-9101) — matched the quoted line first, landed the pin INSIDE the string value, and ` +
        `text-preservingly" (ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}) — a false premise: ` +
        `smol-toml parses workflow = ${JSON.stringify(parsedTpl.workflow)} from these bytes (premise above). ` +
        `On BASE the same call materialized; the false-premise REFUSAL is introduced by this change. The header ` +
        `match must be parse-disciplined the way rebuildInlineUnits is — string content never declares a table.`,
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `the door must materialize a template whose [workflow] table the consumer reads ` +
        `(got ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"})`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const pinned = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
        workflow?: { model?: string }
        notes?: { readme?: string }
      }
      assert.equal(
        pinned.workflow?.model,
        "acme/strong",
        "the pin must land inside the real [workflow] table the consumer reads",
      )
      assert.ok(
        pinned.notes?.readme === parsedTpl.notes?.readme,
        "the documentation string survives the landing byte-for-byte — the pin never rides inside string content",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
