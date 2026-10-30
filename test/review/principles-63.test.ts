import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest, modelPlanFromStages, settingsPlanFromStages } from "../../src/doors/hooks.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

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

// A template whose temperature pins ride NEAREST-declaration models:
// every pin has `model` ON THE UNIT ([[stage.units]] AOT form — a bare
// `model =` line), and [workflow] declares none. This is the shape the
// run-time's own law serves (hooks.ts: "a mind's pin = its NEAREST
// declaration — unit.model → stage.model"; the host resolves the pin
// against spec.model ?? sandboxModelOf ?? modelIn, opencode-host.ts).
function nearestModelTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "p63"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      "[[stage.units]]",
      `id = "principles"`,
      `brief = "p"`,
      `model = "acme/strong"`,
      `temperature = 0.2`,
      "",
    ].join("\n"),
  )
  return where
}

// PREMISE — the consumer's own read: the run-time resolves every pin's
// model by nearest declaration. Both maps are exported on BASE and HEAD.
function consumerPlan(tpl: string): { model: string | undefined; temperature: number | undefined } {
  const stages = loadManifest(tpl).stages ?? []
  const models = modelPlanFromStages(stages)
  const temps = settingsPlanFromStages(stages)
  return { model: models.get("principles"), temperature: temps.get("principles") }
}

// INV-2 (refuse, never vanish — here: the door VANISHES a review the
// run-time runs tuned) / INV-3 ("do the template's temperature pins have
// a model to ride?" is answered by TWO seats that disagree).
//
//   - the CONSUMER (the only seat that acts): modelPlanFromStages maps
//     each pin to unit.model ?? stage.model (hooks.ts, "a mind's pin =
//     its NEAREST declaration"); the host birth resolves the pin
//     against `spec.model ?? sandboxModelOf(cwd) ?? modelIn(cwd)` and
//     refuses ONLY when all three are absent (opencode-host.ts:
//     "temperature … has no model to pin against").
//   - the DOOR (review.ts, the pin-plan's hasModel): `[workflow].model
//     ∧ grammar ∨ --model` — unit.model and stage.model are read by
//     NOTHING at the door. A template whose pins carry their own model
//     is refused with "the template pins per-unit temperature but no
//     model is declared — pass --model <provider/model>", a message
//     whose premise is false (a model IS declared — on the unit) and
//     whose prescribed fix is unnecessary.
//
// On BASE the no-model arm answered with the TABLE-BLIND regex
// /^model\s*=/m, which MATCHED the bare `model =` line inside
// [[stage.units]] — this exact template materialized and ran tuned.
// The diff rewrote the predicate to the consumer-read law for
// [workflow].model (r20 principles-12) and dropped the nearest
// declarations out of the answer: the AOT form REGRESSED from accepted
// to refused. Introduced by this change.
test("a pin with a NEAREST model is not model-less — the door asks the consumer's question", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p63-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = nearestModelTemplate(join(tmp, "tpl"))

    // premise: the run-time's own reads give every pin a model to ride
    const plan = consumerPlan(tpl)
    assert.equal(plan.model, "acme/strong", "premise: modelPlanFromStages resolves the pin to the unit's own model")
    assert.equal(plan.temperature, 0.2, "premise: settingsPlanFromStages reads the pin")

    const r = prepareReview({ repo, base: "master", head: "feat", out, template: tpl }, join(ROOT, "templates"))
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `INV-2/INV-3: "do the template's temperature pins have a model to ride?" is answered two opposite ways. ` +
        `The CONSUMER (the seat that acts) resolves every pin by NEAREST declaration — modelPlanFromStages: ` +
        `unit.model ?? stage.model (hooks.ts: "a mind's pin = its NEAREST declaration"), and the host birth ` +
        `refuses a temperature spawn only when spec.model, sandboxModelOf and modelIn are ALL absent ` +
        `(opencode-host.ts). The DOOR's pin-plan (review.ts hasModel) answers the SAME question with ` +
        `valid-[workflow].model ∨ --model and reads NO unit/stage model: prepareReview refused this template ` +
        `(ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}, why=${JSON.stringify((r as { why?: string }).why ?? "")}) ` +
        `with "the template pins per-unit temperature but no model is declared — pass --model" — a false premise ` +
        `(a model IS declared, on the unit; the premise test proves the consumer reads it) and an unnecessary fix. ` +
        `On BASE the table-blind /^model\\s*=/m matched this template's bare model line and the review ` +
        `materialized and ran TUNED — the diff's rewrite of the predicate (r20 principles-12's law, applied ` +
        `halfway) regressed the AOT form from accepted to refused: the false-refusal class tests-6101/` +
        `principles-61 pinned ("the screen's question must equal the enforcer's question"), one declaration ` +
        `level up. Ask the consumer's question: a pin is model-less only when unit.model, stage.model AND ` +
        `workflow.model are all absent.`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      // the pin AND its model must survive the pipeline verbatim
      const parsed = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string; model?: string; temperature?: number }> }>
      }
      const unit = (parsed.stage ?? []).flatMap((s) => s.units ?? []).find((u) => u?.id === "principles")
      assert.equal(unit?.temperature, 0.2, "the pin survives materialization")
      assert.equal(unit?.model, "acme/strong", "the pin's nearest model survives materialization")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// The audit twin: the model-less dropout audit's strip arm fires on the
// SAME false premise — it strips pins that HAVE a model to ride and
// ships the untuned receipt ("the lenses run on the host default,
// untuned") for lenses the run-time would have run TUNED at their own
// unit model. The receipt's reason ("without one the lenses spawn on
// the host default") is false here: there IS one. Same decision, same
// two seats, the audit path of the finding above.
test("the dropout audit does not strip pins that carry their own model — and reports no untuned receipt", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p63a-"))
  const out = join(tmp, "program")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = nearestModelTemplate(join(tmp, "tpl"))
    const plan = consumerPlan(tpl)
    assert.equal(plan.model, "acme/strong", "premise: the pin's nearest model resolves")

    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `the audit levy materializes (got ok=${String(r.ok)}, why=${JSON.stringify((r as { why?: string }).why ?? "")})`,
    )
    assert.notEqual(
      (r as { untuned?: true }).untuned,
      true,
      `INV-4/INV-3: the untuned receipt ("temperature pins dropped; the lenses run on the host default, ` +
        `untuned") must not fire for pins that HAVE a model to ride — every pin here resolves to its unit's ` +
        `own model (premise above), so nothing needed stripping and nothing runs untuned. The door's ` +
        `hasModel (review.ts) read no unit/stage model, judged the template model-less, and stripped tuning ` +
        `the run-time would have enforced.`,
    )
    const parsed = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<{ id?: string; model?: string; temperature?: number }> }>
    }
    const unit = (parsed.stage ?? []).flatMap((s) => s.units ?? []).find((u) => u?.id === "principles")
    assert.equal(
      unit?.temperature,
      0.2,
      `INV-2/INV-3: the audit's temperature strip must not eat a pin whose NEAREST model exists ` +
        `(unit.model = ${JSON.stringify(unit?.model)}): the strip's own law is "pins are tuning that needs a ` +
        `model to ride" — this pin HAS one (modelPlanFromStages resolves principles → acme/strong; the host ` +
        `resolves spec.model first). The strip ran on the door's [workflow]-only answer to the same question ` +
        `and silently retuned a program the run-time runs tuned. One question — "can this pin ride a model?" — ` +
        `answered by the consumer as unit → stage → workflow and by the door as [workflow] ∨ --model only.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
