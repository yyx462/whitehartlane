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

// isolated OS disk — the door's pipeline is pure, but the sandbox keeps
// the run hermetic (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p51-"))

// BASE shape: the model-less dropout audit (auditLevy) is this diff's
// own addition — no audit path exists there, nothing to judge (the
// momentum-26 device: guarded on the marker this diff introduced,
// vacuous green where it is absent)
const HEAD_HAS_AUDIT = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")

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

function templateAot(where: string, header: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "p51"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      header,
      `id = "principles"`,
      `brief = "p"`,
      "temperature = 0.2",
      "",
      header,
      `id = "tests"`,
      `brief = "t"`,
      "temperature = 0.7",
      "",
    ].join("\n"),
  )
  return where
}

function noUnitTemperature(toml: string): boolean {
  const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<Record<string, unknown>> }> }
  return (parsed.stage ?? []).every((s) => (s.units ?? []).every((u) => !("temperature" in u)))
}

// INV-3 (one decision, one place) — "is this line a [[stage.units]]
// unit-block header?" is answered by TWO sites in src/doors/review.ts,
// and they answer OPPOSITELY on legal TOML:
//   the roster strip's anchor (review.ts:392) — quote-tolerant and
//     trailing-comment-tolerant: /^\[\[\s*stage\s*\.\s*["']?units["']?\s*\]\]\s*(#.*)?$/
//   the temperature strip's detector (review.ts:524) — neither:
//     /^\[\[\s*stage\.units\s*\]\]$/
// The door's own parse (smol-toml) reads `[[stage."units"]]` (a quoted
// key in an array-of-tables header) and `[[stage.units]] # lenses` (a
// trailing comment) into the same stage[].units every other consumer
// reads. On the model-less dropout audit (this diff's own path), the
// temperature strip's arm never enters the block, the pins survive, and
// the strip's own verify refuses with "this is a door bug; report it" —
// a false premise on a template the door's parse and the roster strip
// both accept. The audited escalation dead-ends: no Job, no verdict, no
// label, no greens — while the gate's ledger row already claims
// action:"skip" + audit:true. One spelling later than the two shapes the
// strip was already fixed for (interior spaces gate-r16, exponential
// values gate-r20) — the incomplete-fix class on its own anchor.
for (const [label, header] of [
  ["the quoted-key header", '[[stage."units"]]'],
  ["the trailing-comment header", "[[stage.units]] # lenses"],
] as [string, string][]) {
  test(`a model-less dropout audit levies untuned for ${label}`, () => {
    if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge
    const tmp = mkdtempSync(join(tmpdir(), "whl-p51-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = templateAot(join(tmp, "tpl"), header)

      // premise 1: smol-toml — the run-time's own parser — reads both
      // unit pins from this header spelling
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string; temperature?: number }> }>
      }
      const units = parsed.stage?.[0]?.units ?? []
      assert.deepEqual(
        units.map((u) => u.id),
        ["principles", "tests"],
        `premise: the door's own parser reads both units from ${header}`,
      )
      assert.ok(units.every((u) => typeof u.temperature === "number"), "premise: both units carry temperature pins")

      // premise 2 (the twin half): the SAME template is served by the
      // roster path — the roster strip's anchor accepts this header
      const out2 = join(tmp, "prog-roster")
      const rosterReady = prepareReview(
        { repo, base: "master", head: "feat", out: out2, template: tpl, roster: ["principles"], model: "acme/strong" },
        join(ROOT, "templates"),
      )
      assert.ok(
        rosterReady.ok,
        `premise: the roster strip's header anchor (review.ts:392, quote- and comment-tolerant) serves this ` +
          `template (got ok=${String(rosterReady.ok)}, why=${rosterReady.ok ? "" : (rosterReady as { why: string }).why})`,
      )

      // THE LAW: the model-less audit of the same template must levy
      // untuned — the strip answers every form the door's parse and the
      // roster strip bless
      const out = join(tmp, "program") // must NOT exist beforehand
      const r = prepareReview(
        { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok,
        `INV-3 (${label}): "is this line a [[stage.units]] unit-block header" is decided by TWO sites in ` +
          `src/doors/review.ts that disagree on legal TOML — the roster strip's anchor (review.ts:392, ` +
          `quote- and trailing-comment-tolerant, premise 2 above materialized this very template) and the ` +
          `temperature strip's detector (review.ts:524, /^\\[\\[\\s*stage\\.units\\s*\\]\\]$/ — neither ` +
          `tolerance). The strip never entered the unit block, the pins survived, and the strip's own verify ` +
          `refused: ok=${String(r.ok)}, why=${r.ok ? "" : (r as { why: string }).why} — a false premise on a ` +
          `template the door's parse reads (premise 1). The model-less dropout audit dead-ends with no Job, ` +
          `no verdict, no label, no greens, while the gate's ledger row already claims action:"skip" + ` +
          `audit:true — the skip region stays unmeasured. One spelling later than the shapes this strip was ` +
          `already fixed for (interior spaces, exponential values); the detector must speak the same grammar ` +
          `as its twin arm (and the parse) — or the verify's premise is false.`,
      )
      if (r.ok) {
        const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        assert.ok(
          noUnitTemperature(toml),
          `the materialized audit program must carry no unit temperature pin (the receipt says untuned) — ${header}`,
        )
        const ids = ((parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }).stage ?? []).flatMap((s) =>
          (s.units ?? []).map((u) => u.id),
        )
        assert.deepEqual(ids, ["principles", "tests"], "the units survive the strip")
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}

// control: the spaced header the strip was already fixed for still
// levies — isolating the delta to the quoted/comment tolerances
test("control: the spaced [[ stage.units ]] header still levies untuned", () => {
  if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-p51c-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateAot(join(tmp, "tpl"), "[[ stage.units ]]")
    const out = join(tmp, "program")
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok, `control: the spaced-header audit levies (got ok=${String(r.ok)}, why=${r.ok ? "" : (r as { why: string }).why})`)
    if (r.ok) {
      assert.ok(noUnitTemperature(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")), "control: the pins are stripped")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
