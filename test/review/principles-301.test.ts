import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest, modelPlanFromStages } from "../../src/doors/hooks.ts"
import { parseMembers } from "../../src/engines/coworker.ts"
import { modelIn } from "../../src/adapters/store.ts"

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

// A program whose ONLY model for a member temperature pin is the
// STAGE's `model` — the exact shape the door's new ride oracle
// (unresolvedTemperaturePins, src/doors/review.ts) counts as "rides":
//
//   const rides = entry.model || stageModel || workflowModelValid || cliModel
//
// INV-3 (one decision, one answer) / INV-2 (refuse, never vanish): the
// question the oracle answers is "will this pin's temperature reach a
// model at the seat that acts?" — and NO acting seat reads stage.model
// for a coworker member:
//   - the member birth (src/engines/coworker-run.ts) passes m.model —
//     parseMembers reads [members.<name>] tables only;
//   - modelPlanFromStages (src/doors/hooks.ts) maps solo stage ids and
//     fan-out unit ids — a coworker stage's model maps NOWHERE;
//   - the host's last resort (src/adapters/opencode-host.ts:93,
//     spec.model ?? sandboxModelOf(cwd) ?? modelIn(cwd)) — modelIn
//     reads workflow.model only, and a fresh member sandbox carries no
//     model key.
// With all of those undefined the host REFUSES the spawn ("temperature
// … has no model to pin against (no unit/stage/workflow model) —
// refusing spawn"): every member birth fails, and a model-less dropout
// audit — the levy this diff exists to make measure the skipped class —
// measures nothing: no verdict, no label, no greens, the rate pins at
// 1.0 forever. The diff's own law says where this question belongs: at
// the door ("refuse, never vanish"; "the audit's receipt 'temperature
// pins dropped' must cover every enforced seat"). On BASE the door's
// text-regex twin (^model\s*= anywhere) saw no model line and refused
// this exact template; HEAD's parse-derived oracle reads stage.model,
// answers "rides", and materializes ok:true with the pin intact.
const TEMPLATE_TOML = `# the twin probe: a member pin whose only model is the stage's
[workflow]
name = "twin-probe"
worker_kind = "opencode"

[[stage]]
id = "lenses"
topology = "fan-out"

[[stage.units]]
id = "principles"
brief = "briefs/principles.md"

[[stage]]
id = "exchange"
topology = "coworker"
model = "acme/strong"

[[stage.members]]
name = "alpha"
brief = "briefs/alpha.md"
temperature = 0.4

[[stage.members]]
name = "beta"
brief = "briefs/beta.md"
initiates = true
`

function writeTemplate(where: string): string {
  // the pr-review template's NON-workflow files (REVIEWER.md, SCHEMA.md,
  // the INVARIANTS/QUESTIONS seeds) are copied unconditionally by the
  // door — start from the real template and swap the workflow only
  cpSync(join(ROOT, "templates", "pr-review"), where, { recursive: true })
  writeFileSync(join(where, "workflow.toml"), TEMPLATE_TOML)
  return where
}

test("premise: the acting seats give a stage-model member pin NO model — the door's oracle must not say it rides", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p301-"))
  try {
    const tpl = writeTemplate(join(tmp, "tpl"))
    const manifest = loadManifest(tpl)
    const exchange = manifest.stages!.find((s) => s.topology === "coworker")!
    assert.equal(
      (exchange as { model?: string }).model,
      "acme/strong",
      "premise: the parser accepts stage.model on a coworker stage",
    )
    const alpha = exchange.members!.find((m) => m.name === "alpha")!
    assert.equal(alpha.temperature, 0.4, "premise: the member carries the pin")
    assert.equal(alpha.model, undefined, "premise: the member carries no model of its own")
    assert.equal(manifest.workflow.model, undefined, "premise: no workflow model")
    // the seat that acts: modelPlanFromStages maps solo stage ids and
    // fan-out unit ids — never a coworker member
    const plan = modelPlanFromStages(manifest.stages!)
    assert.equal(plan.has("alpha"), false, "the birth seat never reads stage.model for members")
    // the member-table reader: [members.<name>] only
    const members = parseMembers(TEMPLATE_TOML)
    assert.equal(members.find((m) => m.name === "alpha")?.model, undefined, "parseMembers sees no model")
    // the host's last resort: the workflow pin — absent here
    assert.equal(modelIn(tpl), undefined, "modelIn reads workflow.model only — undefined")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a model-less dropout audit refuses-or-strips a member pin the acting seats cannot ride (stage.model is not a ride)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p301b-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = writeTemplate(join(tmp, "tpl"))
    const ready = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "prog"), template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    // The door must answer the model question the way the seats that
    // act answer it: REFUSE (the missing-model twin, code 2) or strip
    // the unrideable pin and report untuned. Materializing ok:true with
    // the pin intact ships a program whose every member birth is
    // refused at the host — the audited levy measures nothing.
    const materialized = ready.ok && !ready.skipped ? readFileSync(join(ready.dir, "workflow.toml"), "utf8") : ""
    assert.ok(
      !ready.ok || ready.untuned === true,
      `INV-2/INV-3: the door's ride oracle counts stage.model as a model for a MEMBER temperature pin, ` +
        `but no acting seat reads stage.model for members (member birth = m.model; modelPlanFromStages maps ` +
        `solo/fan-out only; modelIn = workflow.model) — the host refuses every member spawn ("temperature … has ` +
        `no model to pin against") and the model-less audit measures nothing. The pin-plan's own law: "the ` +
        `audit's receipt must cover every enforced seat" / "refuse, never vanish". ` +
        `got: ${JSON.stringify(ready)}; materialized bytes still carry the pin: ${/temperature = 0\.4/.test(materialized)}`,
    )
    if (ready.ok && !ready.skipped) {
      // ADAPTED AT ADOPTION (gate-r34, the momentum-34 precedent): the
      // original premise asserted the pin SURVIVED the pipeline — the
      // disease shape (ok:true, pin intact, every member birth refused).
      // The fix resolves the member pin as unrideable and the audit
      // STRIPS it (untuned:true): the fixed shape carries NO pin.
      assert.doesNotMatch(
        materialized,
        /temperature = 0\.4/,
        "the fixed shape: the unrideable member pin is stripped and the untuned receipt reports it",
      )
      assert.equal(ready.untuned, true, "the strip ran and the receipt says so")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the plain model-less spell refuses the same template (the door's own missing-model law, twin seat)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p301c-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = writeTemplate(join(tmp, "tpl"))
    const ready = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    // the missing-model refusal is a DOOR decision (the diff moved it
    // pre-materialization on purpose) — a pin the run-time will refuse
    // must be refused here, or stripped with a receipt
    assert.ok(
      !ready.ok || ready.untuned === true,
      `INV-2: the plain model-less review materializes a member temperature pin whose only model ` +
        `(stage.model) no acting seat reads — the run refuses every member spawn at the host, after the ` +
        `door booked it. got: ${JSON.stringify(ready)}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
