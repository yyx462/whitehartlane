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
  test("tests-3002: BASE — no roster strip, nothing to judge", () => {})
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

  // A LEGAL multi-line basic string carrying a line that STARTS with
  // "]" (a lens brief quoting TOML/shell — review briefs quote syntax
  // all the time). smol-toml — the door's own parser — reads both unit
  // ids from these bytes (premise below), and the door materializes the
  // template roster-less without a word (control below). The strip's
  // multi-line arm locates the block's end by scanning for the first
  // line whose TRIM starts with "]" — the string's interior line
  // matches first, the splice cuts the entry MID-STRING, and the
  // "rebuilt" bytes are broken TOML the pipeline's own parse-verify
  // then refuses with "the template's workflow.toml is not valid TOML
  // — fix the template": a false premise (the template parses; the
  // strip broke it). This is momentum-32's adopted law — "Keep/drop
  // must be per ENTRY (parse-bracketed …), never per line … it must
  // never blame the template for bytes the strip itself broke" — one
  // layout later. The gate's roster subset of a door-legal template
  // dead-ends on a gaslighting receipt.
  const MULTILINE_BRIEF_TOML = [
    "[workflow]",
    `name = "t3002"`,
    `worker_kind = "opencode"`,
    "",
    "[[stage]]",
    `id = "lenses"`,
    `topology = "fan-out"`,
    `units = [`,
    `  { id = "principles", brief = """review the diff, e.g.`,
    `] this line begins with a bracket but lives inside the string`,
    `end of brief""" },`,
    `  { id = "tests", brief = "t" },`,
    `]`,
    "",
  ].join("\n")

  test("the roster strip never manufactures invalid TOML from a multi-line-string brief", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t3002-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      seedDocs(tpl)
      writeFileSync(join(tpl, "workflow.toml"), MULTILINE_BRIEF_TOML)

      // premise: the door's own parser reads BOTH unit ids from these
      // bytes — the shape is legal TOML
      const parsed = parseToml(MULTILINE_BRIEF_TOML) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["principles", "tests"],
        `premise: smol-toml — the door's own parser — reads both unit ids from the multi-line-string brief, got ${JSON.stringify(ids)}`,
      )

      // control: roster-less, the door materializes the template
      // without a word — the shape is door-legal
      const plain = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-plain"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        plain.ok && !("skipped" in plain && plain.skipped),
        `control: the door materializes the multi-line-string template when no roster is given: ${JSON.stringify(plain).slice(0, 240)}`,
      )

      // THE LAW: the roster's decision must be served on the bytes the
      // door's own parse accepts — the subset materializes, and it must
      // never blame the template for bytes the strip itself broke
      const out = join(tmp, "program") // must NOT exist beforehand
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["tests"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3/INV-4 (momentum-32's adopted law, one layout later: "Keep/drop must be per ENTRY ` +
          `(parse-bracketed …), never per line … it must never blame the template for bytes the strip itself ` +
          `broke"): the template's units block carries a LEGAL multi-line basic string brief whose interior ` +
          `contains a line starting with "]" — smol-toml read units ${JSON.stringify(ids)} from these bytes and ` +
          `the door materialized it roster-less without a word (control above). With a roster the door refused ` +
          `(code ${String((r as { code?: number }).code)}): ${JSON.stringify((r as { why?: string }).why ?? "")}. ` +
          `rebuildInlineUnits locates the multi-line block's end by scanning for the first line whose trim ` +
          `starts with "]" — the string's INTERIOR line matches first, the splice cuts the entry mid-string, ` +
          `and the strip manufactures broken TOML from bytes the door's own parse accepts; the pipeline's ` +
          `parse-verify then refuses with "the template's workflow.toml is not valid TOML — fix the template", ` +
          `a false premise. The gate's roster subset of a custom template the door itself blesses vanishes ` +
          `with a gaslighting receipt. Block location must be parse-bracketed, never a bare line scan.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const outIds = (parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
          stage?: Array<{ units?: Array<{ id?: string }> }>
        }).stage?.flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
        assert.deepEqual(
          outIds,
          ["tests"],
          `the roster's decision is served — only the listed lens survives, got ${JSON.stringify(outIds)}`,
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
