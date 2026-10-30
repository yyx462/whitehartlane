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

// BASE shape guard (the momentum-14 device): the model-less dropout
// audit (auditLevy + temperature strip) is this diff's own addition —
// on BASE there is no strip and nothing to judge (vacuous green).
const doorSource = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8")
const doorStripsPins = doorSource.includes("stripTemperaturePins")

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
  // the [[stage.units]] array-of-tables form — the shape the strip's
  // arm 2 exists for (gate-r6 tests-102). ONE pin uses the exponential
  // float spelling `0.2e0` — legal TOML float notation, the identical
  // parsed number 0.2 the decimal spelling carries.
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t5002"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "[[stage.units]]",
      `id = "principles"`,
      "temperature = 0.2e0",
      `brief = "p"`,
      "[[stage.units]]",
      `id = "tests"`,
      "temperature = 0.4",
      `brief = "t"`,
      "",
    ].join("\n"),
  )
  return where
}

// INV-2 (refuse, never vanish — and never a dead-end on the promised
// path) / INV-4 (the bin's audit receipt is a claim): the model-less
// dropout audit (bin/whitehartlane "dropout audit without --model —
// temperature pins dropped; the lenses run on the host default,
// untuned"; the door's own audit branch: "strip them and the lenses
// spawn on the host default, untuned") strips [[stage.units]] pins
// with the line regex /^[ \t]*temperature[ \t]*=[ \t]*[0-9]+(\.[0-9]+)?
// [ \t]*(#.*)?$/ (src/doors/review.ts, arm 2) — which matches the
// DECIMAL spelling only. `temperature = 0.2e0` — exponential float
// notation, legal TOML, parsed by smol-toml into the same number —
// survives the line strip, the parse-driven arm 1 never sees a
// `units = [` block to rebuild, and the post-strip verify
// (hasTemperatureKey on the stripped bytes) then REFUSES the levy with
// "the dropout audit's temperature strip could not strip every pin …
// this is a door bug". The gate-audited skip self-levies (gate-r2
// momentum-15: an audit nobody runs measures nothing) and dead-ends at
// its own door: exit 2, no program, no verdict, no label, no greens —
// the audit the dropout exists to measure, measuring nothing. The
// verify's honesty (refusing a lying receipt) is what turns this
// spelling gap from silent corruption into a hard levy failure; the
// strip must speak the parser's grammar (the parse deletes the key),
// or the audit's one legal-spelling miss kills the whole sample.
//
// Premise pinned: smol-toml parses `temperature = 0.2e0` as the key
// temperature → 0.2 — the consumer reads the pin the strip cannot.
test("the model-less audit levy materializes untuned even when a pin uses exponential float notation", () => {
  // premise: the spelling is legal TOML the door's own parse reads
  const parsed = parseToml('a = 0.2e0') as { a?: unknown }
  assert.equal(
    parsed.a,
    0.2,
    "premise: smol-toml parses the exponential float 0.2e0 as the number 0.2 — the spelling is legal TOML",
  )
  if (!doorStripsPins) return // BASE: no audit strip — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-t5002-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateDir(join(tmp, "tpl"))

    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    // BASE shape: with no audit arm the door refuses the pin-without-model
    // template ("pass --model") — nothing to judge there.
    if (!r.ok && /pass --model/.test(String((r as { why?: string }).why ?? ""))) return
    assert.ok(
      r.ok && !("skipped" in r && r.skipped) && "dir" in r && !!r.dir,
      `INV-2/INV-4: the model-less dropout audit must levy untuned — the bin self-levies an audited skip ` +
        `("an audit nobody runs measures nothing", gate-r2 momentum-15) and promises "temperature pins dropped; ` +
        `the lenses run on the host default, untuned" (bin/whitehartlane). Instead the door returned ` +
        `ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}: the [[stage.units]] line strip ` +
        `(review.ts arm 2, /^[ \\t]*temperature[ \\t]*=[ \\t]*[0-9]+(\\.[0-9]+)?[ \\t]*(#.*)?$/) matches the decimal ` +
        `spelling only and left \`temperature = 0.2e0\` — legal TOML exponential notation, parsed by the door's own ` +
        `smol-toml read (premise above) into the same 0.2 — so the post-strip verify refused the levy with "could ` +
        `not strip every pin (this is a door bug)". The gate-audited skip dead-ends at its own door: no program, ` +
        `no verdict, no label, no greens — the dropout sample measures nothing, the exact dead end the auditLevy ` +
        `flag exists to end. One legal spelling behind the TOML float grammar, on the path this diff was written ` +
        `to serve. The strip must delete the KEY through the parse, not match decimal LINES.`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      const parsedFinal = parseToml(toml) as {
        workflow?: { model?: string }
        stage?: Array<{ units?: Array<Record<string, unknown>> }>
      }
      const pins: string[] = []
      for (const s of parsedFinal.stage ?? []) {
        for (const u of s.units ?? []) {
          if ("temperature" in u) pins.push(String(u.id))
        }
      }
      assert.deepEqual(
        pins,
        [],
        `the materialized audit program must be untuned — no temperature key may survive (got pins on: ${JSON.stringify(pins)})`,
      )
      const ids = (parsedFinal.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u?.id))
      assert.deepEqual(
        [...ids].sort(),
        ["principles", "tests"],
        "the strip drops the pins, never the units — the audit still runs the full roster",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
