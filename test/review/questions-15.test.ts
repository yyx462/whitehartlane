import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// isolated OS disk — the door's pipeline is pure, but the sandbox keeps
// the run hermetic (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-q15-"))

// BASE shape guard (the tests-2006 device): the roster machinery is this
// diff's own addition — on BASE there is no roster path, nothing to judge.
const doorTakesRoster = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes(
  "stripUnitsToRoster",
)

function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
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

// INV-3 (one decision, one answer — "is this singular shape refused
// typed, never an escaped stack?") / the door's own adopted law
// (tests-30: "malformed TOML is a code-2 door refusal, never an escaped
// stack"; tests-2006, gate-r18: a singular [stage] is TYPED-refused —
// ".flatMap on the object escaped as a raw TypeError stack").
//
// The stage twin is guarded at THREE sites (review.ts:716 roster path,
// review.ts:912 handoff). The UNITS twin is the same decision one key
// deeper — `units = { id = "principles", … }` (a dropped bracket: the
// singular inline table is legal TOML the door's own smol-toml parse
// reads into stage[].units as a plain object) — and it is guarded
// NOWHERE: review.ts:724 `(s.units ?? []).map` on the roster path
// throws an uncaught TypeError out of prepareReview. The bin calls
// prepareReview OUTSIDE any try, so `whl review <repo> --model p/m
// --template <tpl>` dies with a raw stack, exit 1 — while the
// singular-STAGE twin of the exact same shape returns a typed code-2
// refusal naming the fix ("rewrite the stage headers").
test("a singular units table is refused typed like its stage twin — never an escaped stack", () => {
  if (!doorTakesRoster) return // BASE: no roster machinery — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-q15-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))

    // ── CONTROL (the door's own law, the stage twin): a singular
    // [stage] gets the typed refusal, never a throw.
    {
      const tpl = join(tmp, "tpl-stage")
      mkdirSync(tpl, { recursive: true })
      seedDocs(tpl)
      writeFileSync(
        join(tpl, "workflow.toml"),
        [
          "[workflow]",
          `name = "q15-stage"`,
          `worker_kind = "opencode"`,
          "",
          "[stage]",
          `id = "lenses"`,
          `topology = "fan-out"`,
          `units = [{ id = "principles", brief = "p" }]`,
          "",
        ].join("\n"),
      )
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out: join(tmp, "p-stage"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        !r.ok && /singular table/.test(String((r as { why?: string }).why ?? "")),
        `control premise: the singular-STAGE twin is typed-refused (got ${JSON.stringify(r).slice(0, 160)})`,
      )
    }

    // ── THE TWIN: a singular units TABLE — legal TOML, one dropped
    // bracket — must get the same treatment: a ReviewReady object
    // (materialization or a typed refusal), never an escaped throw.
    const tpl = join(tmp, "tpl-units")
    mkdirSync(tpl, { recursive: true })
    seedDocs(tpl)
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "q15-units"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = { id = "principles", brief = "p" }`,
        "",
      ].join("\n"),
    )

    let r: unknown
    let threw: unknown
    try {
      // the gate hands roster=[principles,tests,momentum,questions] on
      // EVERY review decision (bin/whitehartlane review verb), and
      // calls prepareReview OUTSIDE any try — this call is the CLI path.
      r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests", "momentum", "questions"], out: join(tmp, "p-units"), template: tpl },
        join(ROOT, "templates"),
      )
    } catch (err) {
      threw = err
    }
    assert.ok(
      threw === undefined,
      `INV-3 (the singular-shape decision: typed refusal, never an escaped stack — tests-30/tests-2006's adopted law): ` +
        `the door guards a singular [stage] at three sites (review.ts:716, review.ts:912) but its UNITS twin is the ` +
        `same decision one key deeper, unguarded: review.ts:724 \`(s.units ?? []).map\` on the roster path threw ` +
        `${threw instanceof Error ? `${threw.constructor.name}: ${threw.message.split("\n")[0]}` : String(threw)} out of ` +
        `prepareReview for a template that is VALID TOML the door's own parse reads (stage[].units as a plain ` +
        `object). The bin calls prepareReview outside any try, so \`whl review --template <tpl>\` on the default ` +
        `gate path dies with a raw TypeError stack, exit 1 — while the identical singular shape one table up ` +
        `returns "the template's [stage] is a singular table … rewrite the stage headers" (code 2). ` +
        `Refuse the units twin typed like its stage twin.`,
    )
    assert.ok(
      typeof r === "object" && r !== null && typeof (r as { ok?: unknown }).ok === "boolean",
      "prepareReview must answer with a ReviewReady, not a throw",
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
    rmSync(tmp, { recursive: true, force: true })
  }
})
