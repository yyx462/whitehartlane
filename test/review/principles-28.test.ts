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

// BASE shape guard (the tests-102 device): the roster strip is this diff's
// own addition — on BASE there is no roster handling, nothing to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("principles-28: BASE — no roster strip, nothing to judge", () => {})
} else {
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

  // INV-2 (refuse, never vanish) / INV-3 (one decision, two answers) / INV-4
  // (a verdict from a zero-lens review is a wrong verdict).
  //
  // The door knows a review with no lenses is not a review: its OWN
  // empty-roster guard refuses with "empty roster — the gate decided skip;
  // do not materialize". But the strip's kept-set can reach the same
  // zero through the back door: stripUnitsToRoster drops every unit whose
  // id is not in the roster, and the post-verify counts only STRAYS
  // ("units outside the roster survived") — when every unit is outside
  // the roster, nothing survives, there are no strays, the verify PASSES,
  // and the door materializes a program with ZERO lens units. The gate's
  // decision ("review, roster = [principles]") is silently inverted into
  // a no-lens pass whose verdict can only be accept-with-nothing-checked —
  // the merge gate accepts on an empty findings set. Reachable on any
  // --template whose lens unit ids don't intersect the gate's roster
  // (the door invites custom templates; the gate's roster is always a
  // subset of the four canonical lens ids). The twin guards disagree:
  // roster.length === 0 refuses; effective kept === 0 sails.
  //
  // Deterministic: a custom [[stage.units]] template (id "sec" — a legal
  // lens id the door's own parse reads), a gate roster of ["principles"].
  // The honest outcome is a refusal naming the mismatch; the shipped door
  // returns ok with zero units. Same hole in all three strip arms
  // (single-line rebuild, multi-line filter, [[stage.units]] blocks).
  test("a gate roster that intersects the template's units in NOTHING refuses — it must not materialize a zero-lens review", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p28-"))
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
          "[workflow]",
          `name = "p28"`,
          `worker_kind = "opencode"`,
          "",
          "[[stage]]",
          `id = "intake"`,
          `topology = "gate"`,
          `run = "true"`,
          "",
          "[[stage]]",
          `id = "lenses"`,
          `topology = "fan-out"`,
          "",
          "[[stage.units]]",
          `id = "sec"`,
          `brief = "look for security twins"`,
          "",
          "[[stage]]",
          `id = "merge"`,
          `topology = "gate"`,
          `run = "true"`,
          "",
        ].join("\n"),
      )

      // premise: the door's own parse reads the template's lens unit —
      // the strip refuses shapes the consumer cannot read; this is not one
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const templateIds = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(templateIds, ["sec"], "premise: smol-toml — the door's own parser — reads the template's lens unit")

      const out = join(tmp, "program") // must NOT exist beforehand
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
        join(ROOT, "templates"),
      )
      const materializedIds = r.ok
        ? ((parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
            stage?: Array<{ units?: Array<{ id?: string }> }>
          }).stage ?? [])
            .flatMap((s) => (s.units ?? []).map((u) => u.id))
            .filter(Boolean)
        : []
      assert.ok(
        !r.ok || materializedIds.length > 0,
        `INV-2 (refuse, never vanish) / INV-3 (one decision, two answers): "is a zero-lens materialization a ` +
          `review?" is answered NO by the door's own empty-roster guard ("empty roster — the gate decided skip; ` +
          `do not materialize") and YES by the strip's back door: stripUnitsToRoster dropped every unit (the ` +
          `template's lens ids and the roster intersect in nothing) and the post-verify counts only STRAYS — ` +
          `zero survivors means zero strays, so the verify passed and the door returned ok=${String(r.ok)} ` +
          `(code=${r.ok ? "-" : String((r as { code?: number }).code)}, why=${r.ok ? "-" : (r as { why?: string }).why}) ` +
          `with materialized lens units ${JSON.stringify(materializedIds)}. The gate's decision — review with ` +
          `roster [principles] — is silently inverted into a no-lens pass whose merge gate can only accept on an ` +
          `empty findings set: a wrong verdict manufactured by materialization. Refuse, like the empty roster: ` +
          `the gate's roster cannot be served on this template, and that is a skip (or a named refusal), never ` +
          `a review that verifies nothing.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
