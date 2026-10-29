import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

// TRACE/MOMENTUM — the gate's roster subset decision must be SERVED on
// every template the door's own parse reads. stripUnitsToRoster
// (review.ts:197) answers "is there a units block?" with TEXT anchors
// while the roster post-verify answers it with smol-toml — two sites,
// one decision (INV-3). Three legal TOML shapes the parse reads fine
// return null from the strip → prepareReview refuses "template has no
// units block for roster subsetting" → `whl review` exits 1 and NO
// review runs at all: the gate's decision to review (subset) kills the
// review, the exact vanish-not-review direction the fail-safe law
// forbids. The strip's own adopted law (tests-100: "a gate roster
// against a legal template materializes the subset — it must not
// refuse"; tests-102: the [[stage.units]] form) is false one shape
// later for each anchor — the incomplete-fix class:
//   (a) closing `]` with a trailing comment — the end-scan
//       (review.ts:271) demands a BARE `]` line, scans to EOF, null;
//   (b) a single-line inline array carrying a NESTED value (env = {…})
//       — the rebuild's scalar() refuses nested values, null;
//   (c) `[[ stage.units ]]` with interior spaces — legal TOML the
//       parse reads; the /^\[\[stage\.units\]\]/ anchor matches
//       nothing, saw stays false, null.
// Introduced by this diff (the strip is new); on BASE there is no
// roster handling, so the device below no-ops there honestly.

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("momentum-28: BASE — no roster strip, nothing to judge", () => {})
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

  const shapes: [string, string][] = [
    [
      "closing ] carries a trailing comment",
      [
        "[workflow]",
        `name = "m28a"`,
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
      ].join("\n"),
    ],
    [
      "single-line entry carries a nested inline value",
      [
        "[workflow]",
        `name = "m28b"`,
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
      "[[ stage.units ]] with interior spaces",
      [
        "[workflow]",
        `name = "m28c"`,
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
    test(`the gate's roster subset is served on a legal template the strip's anchors miss (${label})`, () => {
      const tmp = mkdtempSync(join(tmpdir(), "whl-m28-"))
      const out = join(tmp, "program")
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
          `INV-3 (one decision — "is there a units block" — answered by the strip's text anchors AND ` +
            `the parse, which disagree here) / the strip's own adopted law (tests-100: a gate roster ` +
            `against a legal template materializes the subset — it must not refuse): the door's own ` +
            `parse reads units ${JSON.stringify(ids)} (${label}), yet prepareReview refused ` +
            `(code ${(r as { code?: number }).code}): ${(r as { why?: string }).why}. The gate decided ` +
            `a subset review and the refusal kills the review entirely (bin exit 1) — vanish, not ` +
            `review. The strip must read what the parse reads, or refuse only when the consumer ` +
            `truly cannot read the units.`,
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
