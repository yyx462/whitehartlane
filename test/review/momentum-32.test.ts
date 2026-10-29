import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

// hermetic OS disk (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m32-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard: the roster strip is this diff's own addition — on
// BASE there is no roster handling, nothing to judge (the tests-102
// device: vacuous green there, so the prove gate classifies introduced).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("momentum-32: BASE — no roster strip, nothing to judge", () => {})
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

  // A LEGAL TOML template whose inline-table entries SPAN LINES (TOML
  // legalizes newlines inside inline tables; smol-toml — the door's own
  // parser — reads both unit ids). The strip's multi-line arm decides
  // "is this a unit entry?" PER LINE: the id line matches, the entry's
  // continuation lines (temperature, brief — no id on them) match
  // nothing and are kept unconditionally. Dropping an unlisted unit's
  // id line orphans its continuation lines — the strip MANUFACTURES
  // invalid TOML from bytes the door's own parse accepts, and the
  // pipeline's parse-verify then refuses with the false premise
  // "the template's workflow.toml is not valid TOML — fix the template".
  // The gate's roster subset decision cannot be served on a template
  // shape the door itself blesses (the same law tests-100 pinned for
  // the single-line inline form, one layout later).
  function multilineEntryTemplate(where: string): string {
    mkdirSync(where, { recursive: true })
    seedDocs(where)
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "m32"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles",`,
        `    temperature = 0.2,`,
        `    brief = "p" },`,
        `  { id = "tests", temperature = 0.4, brief = "t" },`,
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

  test("the roster strip serves its decision on a multi-line-entry template — it must not manufacture invalid TOML", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m32-run-"))
    const out = join(tmp, "program")
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = multilineEntryTemplate(join(tmp, "tpl"))

      // PREMISE 1 — the consumer's own read: the door's parser reads both
      // unit ids from these bytes. They are legal TOML.
      const tplToml = readFileSync(join(tpl, "workflow.toml"), "utf8")
      const parsed = parseToml(tplToml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["principles", "tests"],
        `premise: smol-toml — the door's own parser — reads both unit ids from the multi-line-entry template, got ${JSON.stringify(ids)}`,
      )

      // PREMISE 2 — the door ACCEPTS the shape: without a roster the same
      // template materializes without a word (the pin lands, nothing
      // refuses). The template is door-legal.
      const plain = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-plain"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        plain.ok && !("skipped" in plain && plain.skipped),
        `premise: the door materializes the multi-line-entry template when no roster is given: ${JSON.stringify(plain).slice(0, 240)}`,
      )

      // THE LAW — the gate's roster decision must be SERVED on a shape
      // the door's own parse reads: the subset materializes, it must not
      // refuse (tests-100's law, one layout later), and it must never
      // blame the template for bytes the strip itself broke.
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["tests"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3/INV-4 (one decision — "which unit entries does the roster keep?" — answered by the door's parse ` +
          `and by the strip's per-line kept-filter, which disagree on multi-line entries): the door's parse reads ` +
          `units ${JSON.stringify(ids)} from the template and materialized it roster-less without a word, yet with a ` +
          `roster the door refused (code ${String((r as { code?: number }).code)}): ${JSON.stringify((r as { why?: string }).why ?? "")}. ` +
          `stripUnitsToRoster's multi-line arm filters LINES: the entry "{ id = \\"principles\\"," matches its id ` +
          `regex and is dropped, but the entry's continuation lines ("temperature = 0.2," / "brief = \\"p\\" },") match ` +
          `nothing and are kept unconditionally — the strip manufactures INVALID TOML from a legal template and the ` +
          `parse-verify then refuses with "the template's workflow.toml is not valid TOML — fix the template", a false ` +
          `premise (the template parses; the strip broke it). The gate's subset review of a custom template the door ` +
          `itself accepts vanishes with a gaslighting receipt. Keep/drop must be per ENTRY (parse-bracketed, like the ` +
          `single-line arm), never per line.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const outIds = (() => {
          try {
            return (parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
              stage?: Array<{ units?: Array<{ id?: string }> }>
            }).stage?.flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
          } catch {
            return "(unparseable)"
          }
        })()
        assert.deepEqual(
          outIds,
          ["tests"],
          `the roster's decision is served — only the listed lens survives, got ${JSON.stringify(outIds)}`,
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }
  })
}
