import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview, reviewReceipt, type ReviewReady } from "../../src/doors/review.ts"
import { parse as parseToml } from "smol-toml"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const REAL_TEMPLATE = readFileSync(join(ROOT, "templates", "pr-review", "workflow.toml"), "utf8")
// the rail's declared cheapest rung (templates/pr-review [fallback])
const RUNG1 = "minimax-cn/MiniMax-M3.1-Flash"

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

// a template dir from the real one, mutated per case (the tests-31
// harness shape: workflow.toml + the four seed docs is all the door
// reads at stage time)
function tplFrom(tmp: string, mutate: (toml: string) => string): string {
  const tpl = join(tmp, "tpl")
  mkdirSync(tpl, { recursive: true })
  writeFileSync(join(tpl, "workflow.toml"), mutate(REAL_TEMPLATE))
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(tpl, doc), "# seed\n")
  }
  return tpl
}

function stagedModel(out: string): string | undefined {
  const parsed = parseToml(readFileSync(join(out, "workflow.toml"), "utf8")) as { workflow?: { model?: unknown } }
  return typeof parsed.workflow?.model === "string" ? parsed.workflow.model : undefined
}

// THE DEFAULT SEAT (the owner's ruling, 2026-11-02, on the j-ff8ead
// receipt): a `whl review` without --model used to pin NOTHING — every
// lens pane spawned on the host's ambient default (a coding-plan
// seat). The [fallback] ladder's cheapest rung is now the levy
// default, pinned exactly as --model would be.
test("the default seat: no --model pins the [fallback] ladder's cheapest rung — and the temperature pins ride it instead of refusing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-mdef-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tplFrom(tmp, (t) => t) },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !r.skipped, `the door must accept a model-less levy on a ladder-carrying template: ${!r.ok ? r.why : "skipped"}`)
    assert.equal(r.model, RUNG1, "the ready carries the resolved model")
    assert.equal(r.modelDefaulted, true, "the receipt must name the ladder as the chooser")
    assert.equal(stagedModel(out), RUNG1, "the staged workflow.toml carries the pin the run-time reads (modelIn)")
    const staged = readFileSync(join(out, "workflow.toml"), "utf8")
    assert.ok(staged.includes("temperature = 0.2"), "the unit temperature pins survive — they ride the defaulted model instead of refusing or stripping")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the seam: the template's own [workflow].model outranks the ladder — no default flag", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-mdef-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const r = prepareReview(
      {
        repo,
        base: "master",
        head: "feat",
        out,
        template: tplFrom(tmp, (t) => t.replace('worker_kind = "opencode"', 'worker_kind = "opencode"\nmodel = "acme/pinned"')),
      },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !r.skipped, `template-declared model must stage: ${!r.ok ? r.why : "skipped"}`)
    assert.equal(r.model, "acme/pinned")
    assert.notEqual(r.modelDefaulted, true, "a template-declared model is a choice, not the ladder's default")
    assert.equal(stagedModel(out), "acme/pinned")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("--model outranks both the template's model and the ladder", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-mdef-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const r = prepareReview(
      {
        repo,
        base: "master",
        head: "feat",
        model: "acme/explicit",
        out,
        template: tplFrom(tmp, (t) => t.replace('worker_kind = "opencode"', 'worker_kind = "opencode"\nmodel = "acme/pinned"')),
      },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !r.skipped, `explicit --model must stage: ${!r.ok ? r.why : "skipped"}`)
    assert.equal(r.model, "acme/explicit")
    assert.equal(stagedModel(out), "acme/explicit")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a template with neither model nor ladder stays model-less — its temperature pins still refuse honestly, no default is invented", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-mdef-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const noLadder = (t: string) => t.slice(0, t.indexOf("[fallback]")) + t.slice(t.indexOf("[[stage]]"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, template: tplFrom(tmp, noLadder) },
      join(ROOT, "templates"),
    )
    assert.ok(!r.ok, "a template with no model declaration anywhere and unrideable pins must refuse, not invent a model")
    assert.match(r.why, /pass --model/, "the refusal still names the honest remedy")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the strip arm survives for templates with no ladder: a model-less audit still strips unrideable pins (gate-r2 momentum-15)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-mdef-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program")
    const noLadder = (t: string) => t.slice(0, t.indexOf("[fallback]")) + t.slice(t.indexOf("[[stage]]"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, auditLevy: true, template: tplFrom(tmp, noLadder) },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !r.skipped, `the audit must still materialize rather than dead-end (momentum-15): ${!r.ok ? r.why : "skipped"}`)
    assert.equal(r.untuned, true, "the strip fired — the receipt reports the untuned staging")
    assert.equal(stagedModel(out), undefined, "no model is invented for a template that declares none")
    assert.ok(!readFileSync(join(out, "workflow.toml"), "utf8").includes("temperature = "), "the unrideable pins are stripped from the disk bytes")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the receipt names the default (pure, given a ReviewReady)", () => {
  const defaulted: ReviewReady = { ok: true, dir: "/tmp/prog", skipped: false, headShort: "ab12cd34", model: RUNG1, modelDefaulted: true }
  const chosen: ReviewReady = { ok: true, dir: "/tmp/prog", skipped: false, headShort: "ab12cd34", model: "acme/explicit" }
  const d = reviewReceipt(defaulted)
  assert.ok(d.includes(`review: model ${RUNG1} (defaulted`), `the receipt says the ladder chose it and --model overrides — got: ${d}`)
  const c = reviewReceipt(chosen)
  assert.ok(c.includes("review: model acme/explicit\n"), `a chosen model prints without the default flag — got: ${c}`)
  assert.ok(!c.includes("defaulted"))
})
