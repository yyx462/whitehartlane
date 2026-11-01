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

// BASE shape guard (the tests-102 device): the roster strip is this diff's
// own addition — on BASE there is no roster handling, nothing to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("principles-29: BASE — no roster strip, nothing to judge", () => {})
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

  // INV-3 (one decision, one place — "which unit entries does the roster
  // keep?") / the diff's own adopted law (test/review/tests-100: "a gate
  // roster against a legal template materializes the subset — it must not
  // refuse") / the strip's own contract comment ("removes unit entries
  // whose id is not in `keep`, from every units = [ … ] block").
  //
  // tests-100's fix rebuilt the SINGLE-LINE inline array from the PARSE
  // (any id survives re-serialization). The other two arms — the
  // multi-line block line-surgery (review.ts:248) and the [[stage.units]]
  // block walker (review.ts:195) — still decide "is this a unit entry?"
  // with /^[a-z]+"/ — lowercase letters ONLY. A unit id carrying a dash
  // or a digit (the repo's own acknowledged id pattern: the ledger
  // matches generations via startsWith(`${name}-`), and this diff's own
  // momentum-18 fixture uses id "api-v2" in a multi-line units array)
  // matches NEITHER arm's id grammar, so its entry is kept whatever the
  // roster says — and the door's own post-verify then refuses the
  // materialization with "units outside the roster survived the strip …
  // (this is a door bug; report it)". The gate's roster decision cannot
  // be served for the id class the repo itself uses, one id-class later
  // than tests-100: the incomplete-fix shape.
  test("the roster strip keeps its own contract for a dash-bearing unit id — the subset materializes, it must not refuse", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p29-"))
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
          "[workflow]",
          `name = "p29"`,
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
          // the template's own multi-line shape — with ONE dash-bearing
          // generation id among the lens ids (the momentum-18 pattern)
          `units = [`,
          `  { id = "principles", temperature = 0.2, brief = "p" },`,
          `  { id = "tests", temperature = 0.4, brief = "t" },`,
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

      // premise: the door's own parse — the read every verify claims to
      // speak for — reads all three unit ids from these bytes
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["api-v2", "principles", "tests"],
        "premise: smol-toml — the door's own parser — reads all three unit ids, dash included",
      )

      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3/INV-2: "which unit entries does the roster keep?" is answered by the door's own PARSE (the ` +
          `premise above: ${JSON.stringify(ids)}) and by TWO of the strip's three arms with a NARROWER grammar: ` +
          `the multi-line kept-lines filter (review.ts:248, /\\{\\s*id\\s*=\\s*"([a-z]+)"/) and the ` +
          `[[stage.units]] walker (review.ts:195, /^id = "([a-z]+)"/) both require lowercase-letters-only ids, ` +
          `so the entry id "api-v2" matches neither — it is KEPT whatever the roster says, and the door's own ` +
          `post-verify then refused with (code ${String((r as { code?: number }).code)}): ` +
          `${JSON.stringify((r as { why?: string }).why ?? "")}. tests-100 pinned this exact class for the ` +
          `single-line inline form and the fix rebuilt that arm from the parse; the multi-line and ` +
          `[[stage.units]] arms kept the [a-z]+ grammar, so a gate roster still cannot be served on a template ` +
          `carrying the repo's own acknowledged id pattern (the ledger matches generations via ` +
          `startsWith(name + "-"); this diff's own momentum-18 fixture uses id "api-v2" in this exact units ` +
          `shape). The refusal's own text says "this is a door bug; report it" — the strip's contract ("removes ` +
          `unit entries whose id is not in keep, from every units block") must hold for every id the door's ` +
          `parse reads, not only [a-z]+.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        assert.match(toml, /id = "principles"/, "the kept lens survives the strip")
        assert.match(toml, /id = "tests"/, "the kept lens survives the strip")
        assert.doesNotMatch(toml, /id = "api-v2"/, "the roster's decision is served: the unlisted unit is stripped")
        assert.match(toml, /id = "merge"/, "the later stage survives the strip")
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
