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

// BASE shape guard (the momentum-14 device): the roster parameter is
// this diff's own addition — on BASE prepareReview ignores it, so the
// scenario below has nothing to judge there (vacuous green, so the
// prove gate classifies this repro as introduced).
const doorSource = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8")
const doorTakesRoster = doorSource.includes("stripUnitsToRoster")

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

function templateDir(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  // FIVE lens units: the four canonical gate lenses plus a fifth the
  // template author added. Legal TOML, all ids pass SHEP_SAFE_ID — a
  // shape the door's parse reads and materializes verbatim.
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t5001"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [`,
      `  { id = "principles", temperature = 0.2, brief = "p" },`,
      `  { id = "tests", temperature = 0.4, brief = "t" },`,
      `  { id = "momentum", temperature = 0.6, brief = "m" },`,
      `  { id = "questions", temperature = 0.8, brief = "q" },`,
      `  { id = "security", temperature = 0.9, brief = "s" },`,
      `]`,
      "",
    ].join("\n"),
  )
  return where
}

function unitIds(dir: string): string[] {
  const parsed = parseToml(readFileSync(join(dir, "workflow.toml"), "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u?.id)).filter((x): x is string => typeof x === "string")
}

// INV-3 (one decision, one place — "is this roster a subset that needs
// the strip?") / the door's own stated law (src/doors/review.ts, the
// materialization comment): "the gate's roster: a subset materializes
// ONLY those lens units". The implementation keys BOTH the strip AND
// the roster post-verify on the magic constant `args.roster.length < 4`
// (review.ts:550 and review.ts:575) — the CANONICAL gate size, not the
// answer to "does the roster name fewer units than the template
// declares?". A four-element roster — the gate's own full-rail shape —
// that is a strict SUBSET of a five-unit template skips every roster
// check: all five units materialize, the handoff carries five lenses,
// and the gate's subset decision ("review ONLY principles, tests,
// momentum, questions") silently runs five lenses. The zero/stray
// verifications that guard every smaller roster are bypassed at
// exactly the length where "subset" and "full" stop being the same
// thing.
//
// Path that breaks: prepareReview with roster = the four canonical
// lenses over a five-unit template (a template the door otherwise
// accepts and materializes verbatim). The materialized program must
// carry exactly the roster's four units.
test("a four-of-five roster materializes ONLY the roster's lens units", () => {
  if (!doorTakesRoster) return // BASE: no roster machinery — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-t5001-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateDir(join(tmp, "tpl"))

    // ── BASE/support probe: a length-2 roster on this template must
    // strip (the roster machinery works). On BASE the roster is
    // ignored and all five units come back — vacuous green there.
    const probeOut = join(tmp, "probe") // must NOT exist beforehand
    const probe = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: probeOut, template: tpl, roster: ["principles", "tests"] },
      join(ROOT, "templates"),
    )
    if (!(probe.ok && !("skipped" in probe && probe.skipped) && unitIds(probe.dir).length === 2)) {
      return // roster subsetting unsupported (BASE) — nothing to judge
    }

    // ── the judged call: the gate's FULL four-lens roster over the
    // five-unit template — a strict subset of what the template
    // declares.
    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      {
        repo,
        base: "master",
        head: "feat",
        model: "acme/strong",
        out,
        template: tpl,
        roster: ["principles", "tests", "momentum", "questions"],
      },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `sanity: the door materializes this template without a roster: ${JSON.stringify(r).slice(0, 200)}`,
    )
    const dir = (r as { dir: string }).dir
    const ids = unitIds(dir)
    assert.deepEqual(
      [...ids].sort(),
      ["momentum", "principles", "questions", "tests"],
      `INV-3: "a subset materializes ONLY those lens units" (the door's own materialization law, src/doors/review.ts) ` +
        `is decided by the magic constant args.roster.length < 4 (review.ts:550 strip, review.ts:575 verify) — the ` +
        `canonical gate size, not the subset question. The four-element roster [principles, tests, momentum, questions] ` +
        `is a strict subset of this template's five units, yet the materialized program carries ${JSON.stringify(ids)}: ` +
        `the fifth unit ran the review the gate decided to run with four, and the lenses.txt handoff (the one reader ` +
        `intake consumes) carries the roster the gate did not decide. The zero-roster and stray-unit refusals that ` +
        `guard every roster of length 1-3 are bypassed at exactly the length where "full rail" and "subset" stop ` +
        `coinciding. The strip and both verifies must key on the roster-vs-template comparison, not on the constant.`,
    )
    const handoff = readFileSync(join(dir, "data", "review", "lenses.txt"), "utf8").trim().split("\n").filter(Boolean)
    assert.deepEqual(
      [...handoff].sort(),
      ["momentum", "principles", "questions", "tests"],
      `the lens handoff must carry the materialized roster, not a fifth lens the gate's decision excluded ` +
        `(got ${JSON.stringify(handoff)})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
