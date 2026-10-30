import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest } from "../../src/doors/hooks.ts"

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

// does ANY stage unit carry a temperature pin? — the door's own walker,
// scoped to the seats the consumers of the decision claim (unit entries)
function unitTemperaturePins(toml: string): string[] {
  const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string; temperature?: unknown }> }> }
  return (parsed.stage ?? [])
    .flatMap((s) => s.units ?? [])
    .filter((u) => "temperature" in u)
    .map((u) => String(u.id))
}

// the shipped pr-review template with the per-unit temperature pins
// REMOVED and one foreign table added: a domain constant living in a
// table no consumer reads (loadManifest reads workflow/hooks/report/
// layout/detectors/stage — [physics] is tolerated, read by nobody).
// This is not exotic: --template is a first-class door flag, and a
// program's world can carry a temperature that is DATA, not tuning.
function foreignTemperatureTemplate(tmp: string): { tpl: string; repo: string } {
  const repo = fixtureRepo(join(tmp, "repo"))
  const tpl = join(tmp, "tpl")
  cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
  const original = readFileSync(join(tpl, "workflow.toml"), "utf8")
  const scrubbed = original.replace(/ temperature = [0-9.]+,/g, "")
  writeFileSync(
    join(tpl, "workflow.toml"),
    scrubbed + "\n[physics]\n# a domain constant of the simulated world — data, not lens tuning\ntemperature = 0.98\n",
  )
  return { tpl, repo }
}

// premises shared by both shapes — proven once, in the control test
test("premise: the foreign-temperature template is door-legal and consumer-legal (with a model it materializes and loadManifest admits it)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t6101-ctl-"))
  try {
    const { tpl, repo } = foreignTemperatureTemplate(tmp)
    // 1. the template parses and NO stage unit carries a temperature pin
    const pinnedUnits = unitTemperaturePins(readFileSync(join(tpl, "workflow.toml"), "utf8"))
    assert.deepEqual(
      pinnedUnits,
      [],
      "premise: no lens unit in this template carries a temperature pin (they were scrubbed)",
    )
    // 2. the only temperature key in the document lives in the foreign table
    const parsedTpl = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      physics?: { temperature?: unknown }
    }
    assert.equal(parsedTpl.physics?.temperature, 0.98, "premise: the [physics] table carries the only temperature key")
    // 3. the run-time's own read accepts this template shape: WITH a model
    //    the door materializes it and loadManifest admits the program —
    //    the [physics] table breaks nothing downstream
    const ctl = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-ctl"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ctl.ok && !("skipped" in ctl && ctl.skipped),
      `premise: the same template WITH --model materializes (got ${JSON.stringify(ctl).slice(0, 200)}) — the temperature question is the only thing standing between this template and the door`,
    )
    const manifest = loadManifest((ctl as { dir: string }).dir)
    assert.equal(
      (manifest.workflow as { model?: string }).model,
      "acme/strong",
      "premise: loadManifest — the run-time's own read — accepts the materialized program, [physics] table included",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// ── THE LAW, shape A (the plain spell, no model) ──
// "does this template pin per-unit temperature?" — the door's message
// and the strip both speak UNIT pins; a key in a foreign table is not
// one. No unit pin exists, so no model is needed, and the door must
// not refuse. On HEAD this refuses with a FALSE premise ("the template
// pins per-unit temperature") — the tests-41/questions-4-r22 law:
// never refuse on a premise the consumer's own read falsifies.
test("a temperature key no unit carries does not demand a model — the refusal's premise must be true", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t6101-a-"))
  try {
    const { tpl, repo } = foreignTemperatureTemplate(tmp)
    assert.deepEqual(unitTemperaturePins(readFileSync(join(tpl, "workflow.toml"), "utf8")), [], "premise: zero unit pins")
    const a = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "prog-a"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      a.ok,
      `INV-4 (refusals are honest): no lens unit of this template carries a temperature pin — the only temperature ` +
        `key lives in [physics], a table loadManifest tolerates and reads nothing from (the control test: the same ` +
        `template materialized fine WITH a model). Yet the door refused: ` +
        `${JSON.stringify(a).slice(0, 300)} — hasTemperatureKey (src/doors/review.ts:405-413) walks the WHOLE ` +
        `parsed document, while both consumers of its answer — the refusal text ("the template pins per-unit ` +
        `temperature") and stripTemperaturePins (unit blocks and unit arrays only) — speak UNIT pins. The walker ` +
        `must answer the question its consumers ask (stage[].units[].temperature), the same scoping ` +
        `stripTemperaturePins already implements; a temperature key no unit carries is not the door's question.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// ── THE LAW, shape B (the dropout audit levy, no model) ──
// The audit's contract (gate-r2 momentum-15, its own receipt text):
// pins are stripped and the lenses run untuned. With ZERO unit pins
// there is nothing to strip — the audit must levy. On HEAD the strip
// cannot remove the [physics] key (no arm touches it — correctly),
// the post-strip verify walks the whole document again, and the door
// dead-ends the audited levy with "could not strip every pin … this
// is a door bug": no program, no verdict, the dropout measuring
// nothing — the exact harm tests-5002's own receipt names.
test("a model-less dropout audit of a template with zero unit pins levies — it does not dead-end at its own verify", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t6101-b-"))
  try {
    const { tpl, repo } = foreignTemperatureTemplate(tmp)
    assert.deepEqual(unitTemperaturePins(readFileSync(join(tpl, "workflow.toml"), "utf8")), [], "premise: zero unit pins")
    const b = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "prog-b"), template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    assert.ok(
      b.ok,
      `INV-4 / the dropout law ("the skip region is never unmeasured; that is the whole point of the dropout"): ` +
        `a model-less dropout-audit levy of a template with ZERO unit temperature pins must levy — there is ` +
        `nothing to strip. The door refused: ${JSON.stringify(b).slice(0, 300)} — stripTemperaturePins correctly ` +
        `touches only unit seats, but the post-strip verify (hasTemperatureKey over the whole document) demands ` +
        `the [physics] key die too, and the audited escalation dead-ends at its own verify: no program, no ` +
        `verdict, no label, the audit measuring nothing (the tests-5002 harm, one key-seat later).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
