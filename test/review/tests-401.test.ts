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

// INV-3 (one decision, one place) / the gate-r2 momentum-15 law ("the
// ESCALATION still levies — an audit nobody runs measures nothing").
//
// A MODEL-LESS dropout audit must levy untuned: the door strips every
// `temperature = <num>` pin (review.ts stripTemperaturePins) and
// refuses only if a pin survives the strip ("the dropout audit's
// temperature strip could not strip every pin … this is a door bug;
// report it").
//
// THE FAULT: stripTemperaturePins only rewrites lines matching
// /\{\s*id\s*=/ — the `units = [ { id = … } ]` inline-array form. The
// SAME diff blessed the [[stage.units]] array-of-tables form as a
// first-class template shape (gate-r6 tests-102: "the door's parse and
// intake's reader both bless this form"), and the roster strip grew a
// dedicated arm for it (review.ts stripUnitsToRoster's [[stage.units]]
// branch) — but the temperature strip grew none. For a template whose
// lens units ride [[stage.units]] blocks (temperature on its own line),
// the strip misses every pin, the post-strip verify (hasTemperatureKey
// over the parsed doc) catches the survivors, and the door REFUSES the
// audit with code 2. The gate's audited escalation ("dropout audit —
// the skip region stays measured") dead-ends: no Job, no verdict, no
// label, no greens — the audit measures nothing while the ledger row
// claims action:"skip" + audit:true. The dead-end class momentum-15
// exists to prevent, reintroduced one template-form later.
//
// On BASE the scenario is vacuous: auditLevy and the strip do not exist
// there (the audit path is introduced by this diff).
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

// the [[stage.units]] array-of-tables form — the shape gate-r6
// tests-102 blessed (id + temperature each on their own line)
function templateAot(where: string): string {
  mkdirSync(where, { recursive: true })
  seedDocs(where)
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t401"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      "[[stage.units]]",
      `id = "principles"`,
      `brief = "p"`,
      "temperature = 0.2",
      "",
      "[[stage.units]]",
      `id = "tests"`,
      `brief = "t"`,
      "temperature = 0.7",
      "",
    ].join("\n"),
  )
  return where
}

// the inline-array form — the shape the strip WAS written for (control)
function templateInline(where: string): string {
  mkdirSync(where, { recursive: true })
  seedDocs(where)
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t401"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [`,
      `  { id = "principles", brief = "p", temperature = 0.2 },`,
      `  { id = "tests", brief = "t", temperature = 0.7 },`,
      `]`,
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

test("a model-less dropout audit levies untuned for a [[stage.units]] template — the strip answers every form the door blesses", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests401-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const tpl = templateAot(join(tmp, "tpl-aot"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok,
      `INV-3/momentum-15: the model-less dropout audit must LEVY untuned for the [[stage.units]] template form — ` +
        `stripTemperaturePins (review.ts) only rewrites lines matching /\\{\\s*id\\s*=/ (the inline-array form), so ` +
        `every [[stage.units]] temperature pin survives, the verify refuses, and the audited escalation dead-ends ` +
        `with code 2: no Job, no verdict, no label, greens never accrue — the audit measures nothing while the ` +
        `ledger row claims action:"skip" + audit:true. The SAME diff added a [[stage.units]] arm to the ROSTER ` +
        `strip (gate-r6 tests-102 blessed this exact form) and none to the temperature strip — one decision ` +
        `("how do pins leave a model-less audit") answered for one template form only. Result: ok=${String(r.ok)}, ` +
        `why=${r.ok ? "" : (r as { why: string }).why}`,
    )
    if (r.ok) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.ok(
        noTemperatureLeft(toml),
        "the materialized audit program must carry no temperature pin (the receipt says untuned)",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("control: the same audit levies untuned for the inline units = [ … ] form (the strip's home form)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests401-inline-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const tpl = templateInline(join(tmp, "tpl-inline"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok, `control: the inline-form audit levies (got ${r.ok ? "" : (r as { why: string }).why})`)
    if (r.ok) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.ok(noTemperatureLeft(toml), "the inline-form pins are stripped")
      assert.match(toml, /id = "principles"/, "the units survive the strip")
      assert.match(toml, /id = "tests"/, "the units survive the strip")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
