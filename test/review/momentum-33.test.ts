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
  test("momentum-33: BASE — no roster strip, nothing to judge", () => {})
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
    g("add", "-A", )
    g("commit", "-q", "-m", "feat")
    return where
  }

  // MOMENTUM (an ordering that only holds when every stage declares its
  // units the same way) / INV-3 (one decision, one place) — the
  // parse-driven rebuild's zip law (the comment in review.ts): "stages
  // with units in the parse, in order, answer to units blocks in the
  // text, in order (the zip the misindex class tests-901 pinned)".
  // A [[stage.units]] array-of-tables stage puts its units in the PARSE
  // but contributes NO `units = [` TEXT line — the AOT arm handles its
  // blocks separately. For a template whose FIRST units-carrying stage
  // is declared AOT and a LATER stage declares `units = [ … ]`, the zip
  // is shifted by one: the later stage's text line is rebuilt from the
  // AOT stage's PARSED units. The later stage's own rostered units
  // vanish, the AOT stage's unit is duplicated into it, and the
  // strays-verify still passes (every surviving id is in the roster) —
  // ok:true, a materialized program that never runs the units the
  // gate's roster decided on, with no refusal and no receipt. The
  // shipped pr-review template (single [[stage]] + one units array)
  // never mixes the forms; the door accepts any template its parse
  // reads, and this mixing is legal TOML it materializes verbatim on
  // the full-roster path.
  test("the roster zip keeps stage↔block alignment across AOT and array stages — a later units array must serve its OWN stage", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m33-"))
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
          "[workflow]",
          `name = "m33"`,
          `worker_kind = "opencode"`,
          "",
          "[[stage]]",
          `id = "gen1"`,
          `topology = "fan-out"`,
          "[[stage.units]]",
          `id = "alpha"`,
          `brief = "a"`,
          "[[stage.units]]",
          `id = "beta"`,
          `brief = "b"`,
          "",
          "[[stage]]",
          `id = "gen2"`,
          `topology = "fan-out"`,
          `units = [`,
          `  { id = "gamma", brief = "g" },`,
          `  { id = "delta", brief = "d" },`,
          `]`,
          "",
        ].join("\n"),
      )

      // premise: the door's own parse reads BOTH stages' units from
      // these bytes — the shape is legal TOML the parse accepts
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ id?: string; units?: Array<{ id?: string }> }>
      }
      const stages = parsed.stage ?? []
      assert.deepEqual(
        stages.map((s) => (s.units ?? []).map((u) => u.id)),
        [["alpha", "beta"], ["gamma", "delta"]],
        "premise: smol-toml — the door's own parser — reads gen1=[alpha,beta] (AOT) and gen2=[gamma,delta] (array)",
      )

      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["alpha", "gamma"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `premise: the door materializes the mixed-form template (got ${JSON.stringify(r).slice(0, 200)})`,
      )
      const outIds = r.ok
        ? ((parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
            stage?: Array<{ units?: Array<{ id?: string }> }>
          }).stage ?? [])
            .flatMap((s) => (s.units ?? []).map((u) => u.id))
            .filter((x): x is string => typeof x === "string")
        : []
      assert.deepEqual(
        [...outIds].sort(),
        ["alpha", "gamma"],
        `INV-3 (the gate's roster is ONE decision; the strip's contract is "a subset materializes ONLY those ` +
          `lens units"): the roster kept alpha (gen1, AOT) and gamma (gen2, array) — the materialized units are ` +
          `${JSON.stringify(outIds)}. rebuildInlineUnits's zip answers stages-with-units in the parse ` +
          `([alpha..], [gamma,delta]) to units-BLOCKS in the text (one: gen2's line) in order; the AOT stage ` +
          `contributes parse units with no text block, so the zip is shifted one: gen2's units line was rebuilt ` +
          `from GEN1's kept set — gamma and delta vanished from the program, alpha was duplicated into gen2, and ` +
          `the strays-verify passed on the wrong subset (every surviving id is in the roster). The gate decided ` +
          `alpha AND gamma run; the materialized program runs alpha twice and gamma never — the roster decision ` +
          `silently inverted with no refusal and no receipt, the exact class tests-901 pinned for the spaced ` +
          `header, one template shape later (AOT stage before an array stage). Zip by stage identity, not by ` +
          `position — or refuse the mixed form.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
