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
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests1001-"))

// BASE shape: no audit levy and no temperature strip exist there — the
// scenario is vacuous on BASE (the momentum-26 device: guarded on the
// marker this diff introduced, vacuous green where it is absent)
const HEAD_HAS_AUDIT = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")

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

// the [[stage.units]] array-of-tables form with INTERIOR SPACES in the
// header — legal TOML. The repo blesses this spelling in THREE sites
// (the door's parse reads it; stripUnitsToRoster's AOT anchor is
// space-tolerant, gate-r15 tests-1: "interior spaces are legal in the
// header: `[[ stage.units ]]` parses at the door"; intake.sh's awk arm
// is space-tolerant: "Interior spaces in the header are legal TOML").
// stripTemperaturePins's [[stage.units]] arm is the fourth site making
// the same decision — and its matcher `/^\[\[stage\.units\]\]$/` is
// exact-only.
function templateAot(where: string, header: string): string {
  mkdirSync(where, { recursive: true })
  seedDocs(where)
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t1001"`,
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

function noTemperatureLeft(toml: string): boolean {
  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.every(walk)
    if (node && typeof node === "object") {
      return Object.entries(node as Record<string, unknown>).every(([k, v]) => k !== "temperature" && walk(v))
    }
    return true
  }
  return walk(parseToml(toml))
}

test("premise: smol-toml — the run-time's own parser — reads both headers identically", () => {
  for (const header of ["[[stage.units]]", "[[ stage.units ]]"]) {
    const tpl = templateAot(join(mkdtempSync(join(tmpdir(), "whl-t1001-premise-")), "tpl"), header)
    const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string; temperature?: number }> }>
    }
    const units = parsed.stage?.[0]?.units ?? []
    assert.deepEqual(
      units.map((u) => u.id),
      ["principles", "tests"],
      `premise: the consumer's parser reads both unit ids from the ${header} header`,
    )
    assert.ok(units.every((u) => typeof u.temperature === "number"), "premise: both units carry temperature pins")
  }
})

// INV-3 (one decision, one place) / the tests-401 law one shape later:
// a MODEL-LESS dropout audit must levy untuned — stripTemperaturePins
// removes every temperature pin, verified by the parse, and refuses
// only if a pin survives. For a template whose unit blocks are spelled
// `[[ stage.units ]]` (legal TOML; blessed by the door's parse, the
// roster strip's anchor, and intake's awk arm), the exact-only matcher
// never enters the block, every pin survives, the verify refuses with
// code 2 — and the audited escalation dead-ends: no Job, no verdict,
// no label, no greens, the skip region unmeasured while the gate's
// ledger row already claims action:"skip" + audit:true. On BASE the
// scenario is vacuous (no audit levy, no strip — both introduced by
// this change).
test("a model-less dropout audit levies untuned for a `[[ stage.units ]]` template", () => {
  if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-t1001-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program") // must NOT exist beforehand
    const tpl = templateAot(join(tmp, "tpl-spaced"), "[[ stage.units ]]")
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok,
      `INV-3/tests-401's law, one header shape later: the model-less dropout audit must LEVY untuned for the ` +
        `spaced-header template — stripTemperaturePins's [[stage.units]] arm matches /^\\[\\[stage\\.units\\]\\]$/ ` +
        `exactly, so every pin inside a \`[[ stage.units ]]\` block survives, the parse-verify refuses with code 2, ` +
        `and the audited escalation dead-ends (no Job, no verdict, no label, no greens — the ledger row already ` +
        `claims action:"skip" + audit:true). Three sites read this header spelling (the door's parse, the roster ` +
        `strip's anchor, intake's awk arm); the temperature strip is the fourth site answering the same "is this a ` +
        `unit block" decision and the only one that answers strictly. Result: ok=${String(r.ok)}, ` +
        `why=${r.ok ? "" : (r as { why: string }).why}`,
    )
    if (r.ok) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.ok(
        noTemperatureLeft(toml),
        "the materialized audit program must carry no temperature pin (the receipt says untuned)",
      )
      assert.match(toml, /id = "principles"/, "the units survive the strip")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// control: the EXACT header works on HEAD (tests-401's own law) — this
// isolates the delta to the header matcher, not to the fixture shape
test("control: the same audit levies untuned for the exact [[stage.units]] header", () => {
  if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-t1001c-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const tpl = templateAot(join(tmp, "tpl-exact"), "[[stage.units]]")
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok, `control: the exact-header audit levies (got ok=${String(r.ok)}, why=${r.ok ? "" : (r as { why: string }).why})`)
    if (r.ok) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.ok(noTemperatureLeft(toml), "control: the exact-header pins are stripped")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// control: the ROSTER path handles the spaced header (the anchor is
// space-tolerant there) and the model pin lands — proving the fixture
// is otherwise door-valid end to end
test("control: roster subsetting and the model pin both land on the spaced-header template", () => {
  if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-t1001r-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const tpl = templateAot(join(tmp, "tpl-roster"), "[[ stage.units ]]")
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, roster: ["principles"], model: "acme/strong" },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok, `control: the roster levy admits the spaced-header template (got ok=${String(r.ok)}, why=${r.ok ? "" : (r as { why: string }).why})`)
    if (r.ok) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }>; workflow?: { model?: string } }
      assert.deepEqual(
        (parsed.stage?.[0]?.units ?? []).map((u) => u.id),
        ["principles"],
        "control: only the rostered unit survives",
      )
      assert.equal(parsed.workflow?.model, "acme/strong", "control: the model pin lands in the workflow table")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
