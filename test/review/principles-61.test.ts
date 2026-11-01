import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
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
  g("commit", "-q", "-m " + "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

// A NESTED temperature key: `tuning = { temperature = 0.3 }` inside a
// unit entry. Every ENFORCING seat reads only the TOP-LEVEL key —
// hooks.ts loadManifest maps row.id/brief/model/row.temperature and
// ignores `tuning`; settingsPlanFromStages reads unit.temperature; the
// host birth refuses on spec.temperature. A nested table under a unit
// is a table loadManifest ignores — the door's own screen comment
// (src/doors/review.ts, pinsSpawnTemperature) states the law those
// rounds adopted: "Tables no consumer reads (loadManifest ignores
// them) stay out of scope — the tests-6101 false-refusal law."
function nestedTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "p61"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "units = [",
      `  { id = "principles", brief = "p", tuning = { temperature = 0.3 } },`,
      "]",
      "",
    ].join("\n"),
  )
  return where
}

// premise pinned first: the run-time's own manifest read ACCEPTS the
// template and carries NO enforced pin for it — the consumer's question
// ("does this program pin a temperature the RUN-TIME will enforce?")
// is answered NO by the only reader that acts on the answer.
test("premise: the run-time reads no enforced pin from a nested temperature key", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p61-premise-"))
  try {
    const tpl = nestedTemplate(join(tmp, "tpl"))
    const manifest = loadManifest(tpl)
    const unit = manifest.stages?.find((s) => s.id === "lenses")?.units?.[0]
    assert.ok(unit, "premise: loadManifest reads the unit")
    assert.equal(
      (unit as { temperature?: number }).temperature,
      undefined,
      "premise: the nested temperature key is NOT an enforced pin — no consumer reads it",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the door does not refuse a template whose only temperature keys are nested and unread (plain review)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p61-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = nestedTemplate(join(tmp, "tpl"))
    const out = join(tmp, "program") // must NOT exist beforehand

    const r = prepareReview({ repo, base: "master", head: "feat", out, template: tpl }, join(ROOT, "templates"))
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `INV-3/INV-2 (the screen's question must equal the enforcer's question; the screen's own stated law ` +
        `"Tables no consumer reads (loadManifest ignores them) stay out of scope — the tests-6101 ` +
        `false-refusal law", src/doors/review.ts pinsSpawnTemperature): the template's ONLY temperature ` +
        `keys are NESTED inside a unit entry (tuning = { temperature = 0.3 }) — loadManifest (the only ` +
        `enforcing reader, src/doors/hooks.ts:269-291) ignores them and the premise above proves no pin ` +
        `reaches the engine — yet prepareReview refused (ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}): ` +
        `${(r as { why?: string }).why ?? "n/a"}. The deep walk (hasTemperatureKey) counts every nested ` +
        `temperature KEY, so the door vanishes a review the run-time would run untuned — the exact ` +
        `false-refusal class tests-6101 closed for unread TOP-LEVEL tables, alive one nesting level down.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the model-less dropout audit does not dead-end on a nested, unread temperature key", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p61a-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = nestedTemplate(join(tmp, "tpl"))
    const out = join(tmp, "program")

    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    // On BASE there is no audit arm: the plain refusal ("pass --model")
    // fires — same failure, classified by the prove gate, not here.
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `INV-2/INV-4 (the audit's strip and its verify must answer the SAME question the enforcer asks; ` +
        `the bin's audit receipt promises "temperature pins dropped; the lenses run on the host default, ` +
        `untuned", bin/whitehartlane): the gate-audited skip self-levies ("an audit nobody runs measures ` +
        `nothing") — but the strip leaves the nested key (dropTemperature deletes only the top-level key; ` +
        `the [[stage.units]] line arm matches only bare temperature lines) and the post-strip verify ` +
        `re-runs the SAME deep-walk screen, so the levy refused its own door ` +
        `(ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}): ` +
        `${(r as { why?: string }).why ?? "n/a"} — "this is a door bug; report it": no program, no verdict, ` +
        `the dropout sample measures nothing. A nested, unread key dead-ends the audit the strip exists ` +
        `to serve.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
