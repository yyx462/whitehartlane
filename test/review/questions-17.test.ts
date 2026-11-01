import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

// isolated OS disk — keeps the run hermetic (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-q17-"))

const ROOT = join(import.meta.dirname, "..", "..")

// BASE shape: the model-less dropout audit (auditLevy + the temperature
// strip) is this diff's own addition — nothing to judge there.
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

// QUESTIONS #2 / INV-3 — "how do pins leave a model-less dropout
// audit?" is ONE decision. Its INLINE-array arm answers with THE PARSE
// (stripTemperaturePins → rebuildInlineArray: entries come from
// smol-toml, any key order, gate-r17 tests-2005's law). Its
// [[stage.units]] array-of-tables arm answers by LINE ORDER: the
// identity line must appear BEFORE the temperature line
// (stripTemperaturePins captures `blockIdentity` from the first
// `id =`/`name =` line and only a temperature line seen while
// blockIdentity !== null is dropped). TOML legalizes any key order in
// an array-of-tables body; the door's own parse (and the pin screen,
// pinsSpawnTemperature / unresolvedTemperaturePins) reads
// temperature-first entries fine. On such a template the pin survives
// the strip, the strip's own parse-verify catches the survivor, and
// prepareReview REFUSES the audited escalation with "the dropout
// audit's temperature strip could not strip every pin (the strip regex
// missed a form) … this is a door bug; report it" — code 2: no Job, no
// verdict, no label, no greens, while the gate's ledger row already
// claims action:"skip" + audit:true. The audit measures nothing — the
// exact dead-end the strip's own law (momentum-15, gate-r25
// principles-60) exists to prevent, one key ORDER later than the form
// the inline arm was parse-driven for.
test("the audit's [[stage.units]] temperature strip answers key order, not the parse — a temperature-first entry dead-ends the audited levy", () => {
  if (!HEAD_HAS_AUDIT) return // BASE: no audit levy — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-q17-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "q17"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "",
        "[[stage.units]]",
        "temperature = 0.2",
        `id = "principles"`,
        `brief = "p"`,
        "",
        "[[stage.units]]",
        "temperature = 0.7",
        `id = "tests"`,
        `brief = "t"`,
        "",
      ].join("\n"),
    )

    // premise: the door's own parse — the read the pin screen and the
    // strip's verify both claim to speak for — reads both pins from
    // these bytes, temperature-first order included.
    const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string; temperature?: number }> }>
    }
    const units = parsed.stage?.[0]?.units ?? []
    assert.deepEqual(
      units.map((u) => u.id),
      ["principles", "tests"],
      "premise: smol-toml — the door's own parser — reads both units from the temperature-first [[stage.units]] body",
    )
    assert.ok(units.every((u) => typeof u.temperature === "number"), "premise: both entries carry temperature pins")

    // premise (the twin half): the SAME template materializes fine on
    // every other path — with a model the door levies it tuned.
    const withModel = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-model"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      withModel.ok,
      `premise: the door materializes the temperature-first AOT template when a model rides (got ok=${String(withModel.ok)}, why=${withModel.ok ? "" : (withModel as { why: string }).why})`,
    )

    // THE LAW: the model-less dropout audit must LEVY untuned — every
    // pin the parse reads leaves the bytes, whatever key order TOML
    // legalized.
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
      join(ROOT, "templates"),
    )
    assert.equal(
      r.ok,
      true,
      `INV-3 (one decision — "how do pins leave a model-less dropout audit" — answered by TWO arms that disagree): ` +
        `the inline-array arm is parse-driven (rebuildInlineArray — any key order, gate-r17 tests-2005), but the ` +
        `[[stage.units]] arm strips temperature LINES only after it has captured the block's identity from an ` +
        `earlier id/name LINE, so on a temperature-first entry (legal TOML the door's own parse reads — premise ` +
        `above) the pin survives, the strip's own parse-verify catches the survivor, and prepareReview REFUSED the ` +
        `audited escalation (ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}): ` +
        `${JSON.stringify((r as { why?: string }).why ?? "")}. No Job, no verdict, no label, no greens while the ` +
        `gate's ledger row already claims action:"skip" + audit:true — the audit measures nothing (the exact ` +
        `dead-end momentum-15/gate-r25 principles-60 wrote this strip to prevent), one key ORDER later than the ` +
        `shape the inline arm was parse-driven for. The AOT arm must ask the parse (per-entry, like its inline ` +
        `twin), not the line order.`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      const after = parseToml(toml) as { stage?: Array<{ units?: Array<Record<string, unknown>> }> }
      assert.ok(
        (after.stage ?? []).every((s) => (s.units ?? []).every((u) => !("temperature" in u))),
        "the materialized audit program carries no unit temperature pin (the receipt says untuned)",
      )
      assert.deepEqual(
        (after.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)),
        ["principles", "tests"],
        "the units survive the strip",
      )
    }
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
    rmSync(tmp, { recursive: true, force: true })
  }
})
