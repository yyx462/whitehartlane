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

// BASE shape: the roster strip is this diff's own addition — nothing to
// judge there (the tests-102 device).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("tests-201: BASE — no roster strip, nothing to judge", () => {})
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

  // The unit id carries a DIGIT and a DASH — the repo's own blessed
  // wave/generation naming (this diff's momentum-18 fixture: units
  // "api" and "api-v2", "the natural wave/generation naming"). Legal
  // TOML; the door's own parse (smol-toml stage[].units[].id — the
  // roster post-verify's reader) reads it fine.
  function genIdsTemplate(where: string): string {
    mkdirSync(where, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(where, doc), "# seed\n")
    }
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "t201"`,
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
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = "api-v2", brief = "second generation of the api unit" },`,
        `]`,
        "",
        "[[stage]]",
        `id = "merge"`,
        `topology = "gate"`,
        `run = "true"`,
        "",
      ].join("\n"),
    )
    return where
  }

  test("the gate's roster subset materializes for a digit-bearing unit id the door's own parse reads", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-tests201-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = genIdsTemplate(join(tmp, "tpl"))

      // PREMISE — the consumer's own read: the door's roster post-verify
      // (the same walk) reads BOTH ids from the template.
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["api-v2", "principles"],
        "premise: smol-toml — the door's own parser — reads the digit-bearing unit id the strip must drop",
      )

      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok,
        `INV-2/INV-3: "which units survive the roster strip?" is answered by TWO readers that disagree on a ` +
          `door-accepted template: stripUnitsToRoster's line filter matches only \\{ id = "[a-z]+" — a ` +
          `digit/dash-bearing id ("api-v2", the diff's OWN momentum-18 wave/generation naming) matches ` +
          `NOTHING, the entry is silently KEPT, and the parsed post-verify then refuses with the false ` +
          `receipt "roster subsetting failed post-verify — units outside the roster survived the strip: api-v2 ` +
          `(this is a door bug; report it)" (ok=${String(r.ok)}, code=${r.ok ? "-" : String((r as { code?: number }).code)}, ` +
          `why=${r.ok ? "-" : (r as { why?: string }).why}). The template's units are readable by the door's OWN ` +
          `parser (premise above) and by intake's awk arm for [[stage.units]] forms — the strip's ` +
          `id grammar ([a-z]+ only) is the one site that cannot read them, so the gate's subset decision ` +
          `(roster [principles]) cannot be served for the one id shape the repo itself blessed. Refuse only ` +
          `when the consumer truly cannot read the shape — here the consumer reads it fine.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        assert.match(toml, /id = "principles"/, "the kept lens survives the strip")
        assert.doesNotMatch(toml, /id = "api-v2"/, "the gate's roster decision is served: the un-rostered unit is stripped")
        assert.match(toml, /id = "merge"/, "the later stage survives the strip")
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
