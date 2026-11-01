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

// BASE shape: the roster strip is this diff's own addition — on BASE there
// is no roster handling, nothing to judge (the tests-102 device).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("tests-900: BASE — no roster strip, nothing to judge", () => {})
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

  // The strip's own contract (review.ts stripUnitsToRoster): "removes unit
  // entries whose id is not in `keep`, from every units = [ … ] block" —
  // and the diff's adopted law (tests-100): "a gate roster against a legal
  // template materializes the subset — it must not refuse"; tests-31:
  // "refuse only when the consumer truly cannot read the landing".
  //
  // Three MORE legal-TOML shapes the door's own parse reads fine, whose
  // units block none of the strip's textual anchors survive:
  //   (a) a units block whose closing `]` carries a trailing comment —
  //       `] # lenses`; the multi-line end-scan demands a bare `]` line,
  //       scans to EOF, returns null → REFUSAL "template has no units
  //       block for roster subsetting" (code 1);
  //   (b) a single-line unit entry carrying a NESTED inline value (env =
  //       { … }) — the rebuild arm's scalar() returns undefined → null →
  //       the same false-premise refusal;
  //   (c) the [[stage.units]] array-of-tables form with INTERIOR SPACES —
  //       `[[ stage.units ]]` is legal TOML smol-toml parses; the arm's
  //       /^\[\[stage\.units\]\]/ anchor matches nothing, `saw` stays
  //       false → null → the same refusal.
  // In all three the premise ("no units block") is falsified by the
  // door's own parse — the identical class tests-100 pinned for the
  // inline array and tests-102 for the canonical [[stage.units]] form,
  // one shape later each time: the incomplete-fix class.
  const shapes: [string, string][] = [
    [
      "a units block whose closing ] carries a trailing comment",
      [
        "[workflow]",
        `name = "t900a"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = "tests", brief = "t" },`,
        `] # lenses`,
        "",
        "[[stage]]",
        `id = "merge"`,
        `topology = "gate"`,
        `run = "true"`,
        "",
      ].join("\n"),
    ],
    [
      "a single-line unit entry carrying a nested inline value",
      [
        "[workflow]",
        `name = "t900b"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [ { id = "principles", env = { K = "v" }, brief = "p" }, { id = "tests", brief = "t" } ]`,
        "",
      ].join("\n"),
    ],
    [
      "the [[ stage.units ]] array-of-tables form with interior spaces",
      [
        "[workflow]",
        `name = "t900c"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "",
        "[[ stage.units ]]",
        `id = "principles"`,
        `brief = "p"`,
        "[[ stage.units ]]",
        `id = "tests"`,
        `brief = "t"`,
        "",
      ].join("\n"),
    ],
  ]

  for (const [label, toml] of shapes) {
    test(`a gate roster is served on a legal template the strip's anchors miss (${label})`, () => {
      const tmp = mkdtempSync(join(tmpdir(), "whl-t900-"))
      const out = join(tmp, "program") // must NOT exist beforehand
      try {
        const repo = fixtureRepo(join(tmp, "repo"))
        const tpl = join(tmp, "tpl")
        mkdirSync(tpl, { recursive: true })
        for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
          writeFileSync(join(tpl, doc), "# seed\n")
        }
        writeFileSync(join(tpl, "workflow.toml"), toml)

        // PREMISE — the consumer's own read: the door's parser reads the
        // units block from these bytes.
        const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
        const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
        assert.deepEqual(
          [...ids].sort(),
          ["principles", "tests"],
          `premise: smol-toml — the door's own parser — reads the units block (${label})`,
        )

        const r = prepareReview(
          { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
          join(ROOT, "templates"),
        )
        assert.ok(
          r.ok,
          `INV-3/INV-4 (a refusal's premise must survive the door's own consumer read; the strip's own ` +
            `contract "removes unit entries … from every units = [ … ] block" and tests-100's adopted law ` +
            `"a gate roster against a legal template materializes the subset — it must not refuse"): ` +
            `the door's own parse reads units ${JSON.stringify(ids)} from this template (${label}), yet ` +
            `prepareReview refused with code ${r.ok ? "-" : String((r as { code?: number }).code)}: ` +
            `${JSON.stringify(r.ok ? "" : (r as { why?: string }).why)}. The gate's subset decision cannot be ` +
            `served on a template shape the door itself materializes fine — the same false-premise class ` +
            `tests-100 (inline array) and tests-102 ([[stage.units]]) pinned, one shape later. Refuse only ` +
            `when the consumer truly cannot read the units — here it reads them.`,
        )
        if (r.ok && !("skipped" in r && r.skipped)) {
          const outToml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
          assert.match(outToml, /id = "principles"/, "the kept lens survives the strip")
          assert.doesNotMatch(outToml, /id = "tests"/, "the un-rostered unit is stripped — the decision is served")
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
}
