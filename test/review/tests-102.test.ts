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

// BASE shape: roster subsetting does not exist there (no roster param, no
// strip) — nothing to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("tests-102: BASE — no roster strip, nothing to judge", () => {})
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

  // the [[stage.units]] array-of-tables template — the exact form this
  // diff's own gate-r5 work blessed (principles-26: "the door accepts and
  // materializes it (the pin-verify, the temp-pin walk, and the roster
  // post-verify all pass on the parsed shape)"; intake.sh grew a SECOND
  // reader arm just to derive lenses from it)
  function aoTablesTemplate(where: string): string {
    mkdirSync(where, { recursive: true })
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "t102"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "intake"`,
        `topology = "gate"`,
        `run = "true"`,
        "",
        "[[stage.units]]",
        `id = "principles"`,
        "temperature = 0.2",
        `brief = "p"`,
        "[[stage.units]]",
        `id = "tests"`,
        "temperature = 0.4",
        `brief = "t"`,
        "[[stage.units]]",
        `id = "momentum"`,
        "temperature = 0.6",
        `brief = "m"`,
        "[[stage.units]]",
        `id = "questions"`,
        "temperature = 0.8",
        `brief = "q"`,
        "",
        "[[stage]]",
        `id = "merge"`,
        `topology = "gate"`,
        `run = "true"`,
        "",
      ].join("\n"),
    )
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(where, doc), "# seed\n")
    }
    return where
  }

  test("the gate's roster subset materializes from a [[stage.units]] template the door's own parse reads", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t102-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = aoTablesTemplate(join(tmp, "tpl"))

      // PREMISE — the consumer's own read (the same walk the door's roster
      // post-verify runs, and principles-26's own parsedUnitIds): the four
      // lens units are right there in the parsed document.
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["momentum", "principles", "questions", "tests"],
        "premise: smol-toml — the door's own parser — reads all four lens units from the [[stage.units]] template",
      )

      const out = join(tmp, "program") // must NOT exist beforehand
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok,
        `INV-2/INV-3: the roster strip (stripUnitsToRoster, src/doors/review.ts) matches only lines starting ` +
          `"units = [", so a [[stage.units]] array-of-tables template — legal TOML the door's OWN parser reads ` +
          `(premise above: parsed units ${JSON.stringify(ids)}), which this diff's own gate-r5 round blessed ` +
          `(principles-26: "the door accepts and materializes it"), and which intake.sh grew a dedicated awk arm ` +
          `to derive lenses from — returns null from the strip and the door refuses with the FALSE premise ` +
          `"template has no units block for roster subsetting" (code ${String((r as { code?: number }).code)}, ` +
          `why=${(r as { why?: string }).why ?? "n/a"}). The template HAS a units block; the consumer reads it. ` +
          `The same door one flag away (drop roster, keep --model) materializes this exact template fine — ` +
          `the gate's headline decision (a subset materializes ONLY those lens units) cannot be served for the ` +
          `one template form the diff itself made first-class. Refuse only when the consumer truly cannot read ` +
          `the shape — here it can.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        assert.match(toml, /id = "principles"/, "the kept lens survives the strip")
        assert.match(toml, /id = "tests"/, "the kept lens survives the strip")
        assert.doesNotMatch(toml, /id = "momentum"/, "the gate's roster decision is served: momentum is stripped")
        assert.doesNotMatch(toml, /id = "questions"/, "the gate's roster decision is served: questions is stripped")
        assert.match(toml, /id = "merge"/, "the later stage survives the strip")
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
