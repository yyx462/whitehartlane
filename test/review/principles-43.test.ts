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
// judge there (the momentum-28/tests-3003 device).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("principles-43: BASE — no roster strip, nothing to judge", () => {})
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

  const parseIds = (toml: string): string[] => {
    const p = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
    return (p.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
  }

  // ── shape 1: the [[stage.units]] arm's block-extent scan
  // (`while (!/^\[/)` on TRIMMED lines) stops at the first line that
  // begins with `[` — including a line INSIDE a multi-line basic
  // string brief. Dropping that unit splices mid-string; the document
  // no longer parses; the door refuses "template has no units block
  // for roster subsetting" — a FALSE premise (the door's own parse
  // read both units from these bytes) that kills the review.
  const MULTILINE_BRIEF_TOML = [
    "[workflow]",
    `name = "p43a"`,
    `worker_kind = "opencode"`,
    "",
    "[[stage]]",
    `id = "lenses"`,
    `topology = "fan-out"`,
    "",
    `[[stage.units]]`,
    `id = "principles"`,
    `brief = """`,
    `read the law first.`,
    `  [workflow]`,
    `is an example table header.`,
    `"""`,
    "",
    `[[stage.units]]`,
    `id = "tests"`,
    `brief = "t"`,
    "",
  ].join("\n")

  // ── shape 2: a quoted segment in the array-of-tables header —
  // [[stage."units"]] is legal TOML the parse reads as stage→units;
  // the arm's header anchor /^\[\[\s*stage\.units\s*\]\]/ matches
  // nothing, saw stays false, and the SAME false-premise refusal fires.
  const QUOTED_HEADER_TOML = [
    "[workflow]",
    `name = "p43b"`,
    `worker_kind = "opencode"`,
    "",
    "[[stage]]",
    `id = "lenses"`,
    `topology = "fan-out"`,
    "",
    `[[stage."units"]]`,
    `id = "principles"`,
    `brief = "p"`,
    "",
    `[[stage."units"]]`,
    `id = "tests"`,
    `brief = "t"`,
    "",
  ].join("\n")

  for (const [label, toml] of [
    ["a multi-line brief carrying a bracketed example line", MULTILINE_BRIEF_TOML],
    ["a quoted [[stage.\"units\"]] header segment", QUOTED_HEADER_TOML],
  ] as const) {
    test(`the gate's roster subset materializes on a [[stage.units]] template the parse reads (${label})`, () => {
      const tmp = mkdtempSync(join(tmpdir(), "whl-p43-"))
      const out = join(tmp, "program")
      try {
        const repo = fixtureRepo(join(tmp, "repo"))
        const tpl = join(tmp, "tpl")
        mkdirSync(tpl, { recursive: true })
        seedDocs(tpl)
        writeFileSync(join(tpl, "workflow.toml"), toml)

        // premise — the door's own parse (review.ts parsedOriginal, the
        // SAME read that decides rosterSubsets) reads BOTH unit ids
        const ids = parseIds(toml)
        assert.deepEqual(
          [...ids].sort(),
          ["principles", "tests"],
          `premise: smol-toml — the door's own parser — reads both units from these bytes (${label}), got ${JSON.stringify(ids)}`,
        )

        const r = prepareReview(
          { repo, base: "master", head: "feat", model: "acme/strong", roster: ["tests"], out, template: tpl },
          join(ROOT, "templates"),
        )
        assert.ok(
          r.ok && !("skipped" in r && r.skipped),
          `INV-3 (one decision, two answers — the strip's [[stage.units]] arm locates blocks and their ends by TEXT ` +
            `while the same diff's inline arm declares "THE PARSE IS THE EXTENT ORACLE") / the strip's own adopted law ` +
            `(tests-100: a gate roster against a legal template materializes the subset — it must not refuse): ` +
            `the door's parse read units ${JSON.stringify(ids)} (${label}), yet prepareReview refused ` +
            `(ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}): ${(r as { why?: string }).why ?? "n/a"}. ` +
            `The refusal names a false premise — "no units block" — for a template whose units block the door's own ` +
            `parse just read, and the refusal kills the review entirely (bin exit 1): vanish, not review — the ` +
            `momentum-28 class one arm later. The [[stage.units]] arm must speak the parser's grammar (parse-driven ` +
            `extent, quote-tolerant header) or refuse with the TRUE premise.`,
        )
        if (r.ok && !("skipped" in r && r.skipped)) {
          const outIds = parseIds(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8"))
          assert.deepEqual(
            [...outIds].sort(),
            ["tests"],
            `the rostered subset materializes (got ${JSON.stringify(outIds)})`,
          )
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
}
