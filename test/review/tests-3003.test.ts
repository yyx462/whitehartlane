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

// BASE shape: the roster strip is this diff's own addition — nothing to
// judge there (the tests-102 device).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("tests-3003: BASE — no roster strip, nothing to judge", () => {})
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

  function seedDocs(where: string): void {
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(where, doc), "# seed\n")
    }
  }

  // INV-3 (one decision, one place — "which units does each stage keep?")
  // / INV-4 (the materialization must serve the gate's roster). The
  // parse-driven rebuild zips "stages-with-units IN THE PARSE, in order"
  // against "units = [ blocks IN THE TEXT, in order" (the tests-901
  // zip). But a [[stage.units]] array-of-tables stage contributes
  // parse-stage-units WITHOUT a text block — the shape this same diff
  // blessed and built a whole walker arm for (tests-102). In a MIXED
  // template (the lenses stage as [[stage.units]] sub-tables, a later
  // stage with an inline units array — both legal, the door
  // materializes the template roster-less without a word), the zip is
  // desynced by one: the inline stage's text block is rebuilt from the
  // TABLE stage's parsed units. The rostered inline unit silently
  // VANISHES, the table stage's unit is DUPLICATED into the later
  // stage, the stray-check passes (both ids are in the roster), and the
  // door returns ok:true — the gate's roster decision silently
  // inverted, no refusal, no receipt.
  const MIXED_TOML = [
    "[workflow]",
    `name = "t3003"`,
    `worker_kind = "opencode"`,
    "",
    "[[stage]]",
    `id = "lenses"`,
    `topology = "fan-out"`,
    "[[stage.units]]",
    `id = "principles"`,
    `brief = "p"`,
    "",
    "[[stage]]",
    `id = "deep"`,
    `topology = "fan-out"`,
    `units = [ { id = "questions", brief = "q" } ]`,
    "",
  ].join("\n")

  test("a mixed [[stage.units]] + inline template materializes the roster per stage — the zip must not desync", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t3003-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      seedDocs(tpl)
      writeFileSync(join(tpl, "workflow.toml"), MIXED_TOML)

      // premise: the door's own parse reads both stages' units from
      // these bytes — the mixed shape is legal TOML
      const parsed = parseToml(MIXED_TOML) as { stage?: Array<{ id?: string; units?: Array<{ id?: string }> }> }
      const shape = (parsed.stage ?? []).map((s) => [s.id, (s.units ?? []).map((u) => u.id)])
      assert.deepEqual(
        shape,
        [["lenses", ["principles"]], ["deep", ["questions"]]],
        `premise: smol-toml reads the mixed form's stages and units, got ${JSON.stringify(shape)}`,
      )

      // control: roster-less, the door materializes the template
      // without a word — the shape is door-legal
      const plain = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-plain"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        plain.ok && !("skipped" in plain && plain.skipped),
        `control: the door materializes the mixed template when no roster is given: ${JSON.stringify(plain).slice(0, 240)}`,
      )

      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "questions"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `sanity: the rostered subset materializes (got ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}, why=${(r as { why?: string }).why ?? "n/a"})`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const outParsed = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
          stage?: Array<{ id?: string; units?: Array<{ id?: string }> }>
        }
        const outShape = (outParsed.stage ?? []).map((s) => [s.id, (s.units ?? []).map((u) => u.id)])
        assert.deepEqual(
          outShape,
          [["lenses", ["principles"]], ["deep", ["questions"]]],
          `INV-3/INV-4 (the door's own contract: "a subset materializes ONLY those lens units", per stage): ` +
            `the gate's roster ["principles","questions"] against a MIXED template — the lenses stage declared ` +
            `as [[stage.units]] sub-tables (the form this diff's own tests-102 blessed), the deep stage with an ` +
            `inline units array — materialized ${JSON.stringify(outShape)} instead of ` +
            `[["lenses",["principles"]],["deep",["questions"]]]. rebuildInlineUnits zips stages-with-units IN ` +
            `THE PARSE (which counts the [[stage.units]] stage, contributing NO text block) against units = [ ` +
            `blocks IN THE TEXT, in order: the deep stage's text block was rebuilt from the LENSES stage's ` +
            `parsed units — the rostered "questions" lens silently VANISHED from the program and "principles" ` +
            `was duplicated into the deep stage. The stray-check passes (both ids are rostered), the door ` +
            `returns ok:true, and the gate's roster decision is silently inverted with no refusal and no ` +
            `receipt — the tests-901 misindex class, alive again one template shape later. Each text block ` +
            `must be rebuilt from ITS OWN stage's parsed units (match blocks to stages, not a flat zip).`,
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
