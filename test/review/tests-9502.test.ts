import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the tests-3001 device): the pin-verify does not exist
// there — the false-premise refusal below cannot arise on BASE (the old
// door's regex insert silently no-ops and materializes), so the repro is
// vacuous green there and judges the HEAD verify only.
const doorOwnsThePin = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes(
  "pinIntoWorkflowTable",
)

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

// THE BODY of the pin landing (review.ts pinIntoWorkflowTable, arm 3):
// the single-line inline-table arm rebuilds the ONE workflow line from
// the parse — but with a SCALAR-only serializer (`scalar()` returns
// undefined for "nested structures: not this arm's form", and the arm
// then returns undefined for the WHOLE landing). A workflow table
// declared as an inline table carrying ONE nested value —
//
//     workflow = { name = "t9502", worker_kind = "opencode", knobs = { debug = true } }
//
// — is legal TOML smol-toml (the run-time's own parser, the read the
// verify's comment claims to speak for) parses into a working workflow
// table. All three arms miss it: the header arm finds no [workflow]
// header, the dotted arm finds no workflow.* keys, the inline arm
// matches the line and then BAILS on the nested value. prepareReview
// refuses with "the template's workflow.toml has no [workflow] table the
// door can pin text-preservingly (a [workflow] header block, dotted
// workflow.* keys, or a single-line inline table …)" — a FALSE premise
// twice over: the template HAS a workflow table, and it IS a single-line
// inline table (both "supported" forms the refusal names). The twin
// serializer one function over — rebuildInlineUnits's inline(), for the
// roster strip — is explicitly TOTAL over the parse's own value shapes
// ("gate-r15 tests-1: nested tables and arrays"): one decision ("can the
// door rewrite this template's TOML in place?") answered by two
// serializers with different totality. The repo's own adopted law
// (test/review/tests-31, in this tree): "refuse only when the consumer
// truly cannot read the landing." Meta-ACH: the nested-value shape one
// level deeper than the scalar shape principles-15 pinned.
test("the door never refuses a template whose inline [workflow] table the consumer reads — nested value included", () => {
  if (!doorOwnsThePin) return // BASE: no pin-verify — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-t9502-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        `workflow = { name = "t9502", worker_kind = "opencode", knobs = { debug = true } }`,
        ``,
        `[[stage]]`,
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [{ id = "principles", brief = "b" }]`,
        ``,
      ].join("\n"),
    )

    // PREMISE — the consumer's own read: the run-time's parser reads a
    // workflow table from these bytes, nested value and all.
    const consumerSees = (parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      workflow?: unknown
    }).workflow
    assert.ok(
      consumerSees !== undefined,
      "premise: smol-toml — the run-time's own parser — reads the workflow table from the nested-value inline form",
    )

    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    const falsePremise =
      !r.ok && /no \[workflow\] table/.test(String((r as { why?: string }).why ?? ""))
    assert.ok(
      !falsePremise,
      `INV-2/INV-4 (a refusal's premise must survive the consumer's own read; the door's own adopted law ` +
        `tests-31: "refuse only when the consumer truly cannot read the landing"): the template declares its ` +
        `workflow table as ONE single-line inline table carrying a nested value — smol-toml (the read the ` +
        `pin-verify claims to speak for) parses workflow = ${JSON.stringify(consumerSees)} — yet the pin landing ` +
        `(review.ts pinIntoWorkflowTable) returned undefined and prepareReview refused with "no [workflow] table ` +
        `the door can pin text-preservingly (a [workflow] header block, dotted workflow.* keys, or a single-line ` +
        `inline table …)" (ok=${String(r.ok)}, code=${String((r as { code?: number }).code ?? "-")}, ` +
        `why=${JSON.stringify((r as { why?: string }).why ?? "")}). The premise is false twice: the template HAS ` +
        `a workflow table, and it IS one of the refusal's own named supported forms (a single-line inline table). ` +
        `The inline arm bails because its scalar() serializer refuses nested values — while the TWIN serializer ` +
        `one function over (rebuildInlineUnits's inline(), the roster strip's) is explicitly TOTAL over the ` +
        `parse's own value shapes ("gate-r15 tests-1: nested tables and arrays"). One decision — can the door ` +
        `rewrite this template in place? — two serializers, one total and one not; the gate's model pin cannot ` +
        `be served on a template the door's own roster strip rewrites happily. On BASE the same call ` +
        `materialized (the old regex insert no-op'd silently), so the FALSE REFUSAL is introduced by this change.`,
    )
    // any acceptance must land the pin where the consumer reads it
    if (r.ok && !("skipped" in r && r.skipped)) {
      const pinnedToml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.equal(
        (parseToml(pinnedToml) as { workflow?: { model?: string } }).workflow?.model,
        "acme/strong",
        "if accepted, the pin must land inside the workflow table the consumer reads",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// CONTROL (proves the harness): the scalar-only inline form — the shape
// principles-15 fixed — still lands. If this control fails the premise
// drift is elsewhere.
test("control: the scalar inline workflow table lands the pin", () => {
  if (!doorOwnsThePin) return
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9502c-"))
  const out = join(tmp, "program")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        `workflow = { name = "t9502c", worker_kind = "opencode" }`,
        ``,
        `[[stage]]`,
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [{ id = "principles", brief = "b" }]`,
        ``,
      ].join("\n"),
    )
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `control: the scalar inline form materializes (got ${JSON.stringify(r).slice(0, 160)})`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      assert.equal(
        (parseToml(readFileSync(join(r.dir, "workflow.toml"), "utf8")) as { workflow?: { model?: string } })
          .workflow?.model,
        "acme/strong",
        "control: the pin landed in the inline workflow table",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
