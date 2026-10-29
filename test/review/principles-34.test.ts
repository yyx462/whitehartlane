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

// BASE shape guard (the tests-102 device): the roster strip is this
// diff's own addition — on BASE there is no roster handling, nothing
// to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("principles-34: BASE — no roster strip, nothing to judge", () => {})
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

  function parsedUnitIds(tomlPath: string): string[] {
    const parsed = parseToml(readFileSync(tomlPath, "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string }> }>
    }
    return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
  }

  // INV-3 (one decision, one place — "which unit entries does the roster
  // keep?") / the diff's own law, written in its own bytes: intake.sh's
  // derivation was widened (gate-r10 principles-31) because "TOML
  // legalizes indented blocks, {id = "x"} unpadded braces, and single
  // quotes — and the door's parse materializes all of it; the reader
  // must read what the door writes." The roster strip is the OTHER
  // reader of the same decision, and its two text arms were NOT
  // widened: the [[stage.units]] walker matches /^id = "/ (one space,
  // double quote — review.ts:199) and the multi-line arm
  // /\{\s*id\s*=\s*"/ (review.ts:252). gate-r8/principles-29 widened
  // the arms' ID CHARSET to SHEP_ID_CLASS but left the QUOTE/PADDING
  // spelling double-quote-exact — one diff later than the law that
  // forbids it. For a template the door's own parse reads and
  // materializes without a word (single-quoted ids, or an unpadded
  // `id="x"` key), the strip keeps every entry whatever the roster
  // says, and the door's own post-verify then refuses the
  // materialization with "units outside the roster survived the strip
  // … (this is a door bug; report it)" — the gate's roster decision
  // dead-ends on a shape the door itself blessed. The same
  // incomplete-fix class principles-29 pinned (charset), one grammar
  // dimension later (spelling).
  for (const [label, unitsToml] of [
    [
      "[[stage.units]] blocks, single-quoted id (id = 'tests')",
      [
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "",
        "[[stage.units]]",
        `id = "principles"`,
        `brief = "p"`,
        "",
        "[[stage.units]]",
        `id = 'tests'`,
        `brief = "t"`,
        "",
      ].join("\n"),
    ],
    [
      "multi-line units array, single-quoted id ({ id = 'tests', … })",
      [
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = 'tests', brief = "t" },`,
        `]`,
        "",
      ].join("\n"),
    ],
    [
      "[[stage.units]] blocks, unpadded key (id=\"tests\")",
      [
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "",
        "[[stage.units]]",
        `id = "principles"`,
        `brief = "p"`,
        "",
        "[[stage.units]]",
        `id="tests"`,
        `brief = "t"`,
        "",
      ].join("\n"),
    ],
  ] as [string, string][]) {
    test(`the roster strip reads what the door's parse reads — ${label}`, () => {
      const tmp = mkdtempSync(join(tmpdir(), "whl-p34-"))
      const out = join(tmp, "program")
      try {
        const repo = fixtureRepo(join(tmp, "repo"))
        const tpl = join(tmp, "tpl")
        mkdirSync(tpl, { recursive: true })
        seedDocs(tpl)
        writeFileSync(
          join(tpl, "workflow.toml"),
          [
            "[workflow]",
            `name = "p34"`,
            `worker_kind = "opencode"`,
            "",
            unitsToml,
          ].join("\n"),
        )

        // premise 1: smol-toml — the door's own parser — reads BOTH ids
        // from these bytes (the shapes are legal TOML)
        const tplIds = parsedUnitIds(join(tpl, "workflow.toml"))
        assert.deepEqual(
          [...tplIds].sort(),
          ["principles", "tests"],
          `premise (${label}): the door's own parse reads both unit ids, got ${JSON.stringify(tplIds)}`,
        )

        // premise 2: without a roster the door MATERIALIZES this
        // template without a word — the shape is door-legal
        const plain = prepareReview(
          { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-plain"), template: tpl },
          join(ROOT, "templates"),
        )
        assert.ok(
          plain.ok && !("skipped" in plain && plain.skipped),
          `premise (${label}): the door materializes this template with no roster: ${JSON.stringify(plain).slice(0, 200)}`,
        )

        // the law: the gate's roster decision must be servable — the
        // strip drops the unlisted unit, the subset materializes
        const r = prepareReview(
          { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
          join(ROOT, "templates"),
        )
        assert.equal(
          r.ok,
          true,
          `INV-3 (${label}): "which unit entries does the roster keep?" is answered by TWO readers after this ` +
            `diff — the door's parse (which materialized ${JSON.stringify(tplIds)} and refused nothing) and the ` +
            `strip's text arms ([[stage.units]] walker review.ts:199 /^id = "/ and multi-line arm review.ts:252 ` +
            `/\\{\\s*id\\s*=\\s*"/ — both double-quote- and padding-exact). The diff's own intake.sh law says the ` +
            `reader must read what the door writes ("TOML legalizes … unpadded braces, and single quotes — and ` +
            `the door's parse materializes all of it"), and principles-29 widened these same arms' charset one ` +
            `round earlier — but the spelling was left narrow, so the unlisted unit SURVIVED the strip and the ` +
            `door refused its own materialization (code ${String((r as { code?: number }).code)}): ` +
            `${JSON.stringify((r as { why?: string }).why ?? "")}. The gate's roster decision dead-ends on a ` +
            `door-accepted shape; one decision, two readers, opposite answers.`,
        )
        if (r.ok && !("skipped" in r && r.skipped)) {
          const ids = parsedUnitIds(join((r as { dir: string }).dir, "workflow.toml"))
          assert.deepEqual(
            [...ids].sort(),
            ["principles"],
            `(${label}): the roster's decision is served — only the listed lens survives, got ${JSON.stringify(ids)}`,
          )
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
}
