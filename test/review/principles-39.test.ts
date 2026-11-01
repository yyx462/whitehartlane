import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the tests-102 device): the lenses.txt handoff is
// this diff's own addition — on BASE the door never wrote it, so the
// scenario below has nothing to judge there (and on BASE the same
// prepareReview call succeeds: the old door only refused a model-less
// materialization when the template carried temperature pins).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("lenses.txt")) {
  test("principles-39: BASE — no lens handoff, nothing to judge", () => {})
} else {
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

  // A pin-free custom template — the --template path the door's own pin
  // arms and strip arms exist to serve. No temperature pins anywhere, so
  // a model-less materialization is door-legal (BASE materialized it).
  function pinFreeTemplate(where: string): string {
    mkdirSync(where, { recursive: true })
    seedDocs(where)
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "p39"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = "tests", brief = "t" },`,
        "]",
        "",
      ].join("\n"),
    )
    return where
  }

  // A self-pinned template: [workflow] carries its own model, the lens
  // units pin temperature against it — also door-legal without --model.
  function selfPinnedTemplate(where: string): string {
    mkdirSync(where, { recursive: true })
    seedDocs(where)
    writeFileSync(
      join(where, "workflow.toml"),
      [
        "[workflow]",
        `name = "p39b"`,
        `worker_kind = "opencode"`,
        `model = "acme/strong"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", temperature = 0.2, brief = "p" },`,
        `  { id = "tests", temperature = 0.7, brief = "t" },`,
        "]",
        "",
      ].join("\n"),
    )
    return where
  }

  // THE CRASH: the content pipeline declares `templateToml` block-locally
  // (src/doors/review.ts, the `let workflowTomlOut` block) and the new
  // lenses.txt handoff (review.ts:669) reads `workflowTomlOut ??
  // templateToml` AFTER that block. The ?? evaluates templateToml only
  // when workflowTomlOut is undefined — exactly the shape where the
  // pipeline changed nothing (no --model, nothing to strip). The door
  // then dies with `ReferenceError: templateToml is not defined`
  // instead of answering: no ReviewReady, no refusal, no receipt — the
  // raw stack escapes prepareReview (the bin's review verb has no
  // catch around it). Every model-less materialization whose template
  // carries no strippable pins crashes: a pin-free --template (this
  // test), a self-pinned --template, and the diff's own model-less
  // dropout-audit levy on either (the bin escalates audits WITHOUT
  // --model by design). On BASE the same call materialized cleanly.
  test("a model-less materialization of a pin-free template answers — it must not die on the lens handoff", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p39-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = pinFreeTemplate(join(tmp, "tpl"))

      let ready: ReturnType<typeof prepareReview> | undefined
      let crashed: unknown
      try {
        ready = prepareReview({ repo, base: "master", head: "feat", out, template: tpl }, join(ROOT, "templates"))
      } catch (err) {
        crashed = err
      }
      assert.ok(
        crashed === undefined,
        `INV-4 (an infra failure is never an answer — the door must return a ReviewReady, never throw): ` +
          `prepareReview crashed on a door-legal model-less materialization: ` +
          `${crashed instanceof Error ? `${crashed.message} (src/doors/review.ts:669 — the lenses.txt handoff reads ` +
          `\`workflowTomlOut ?? templateToml\` outside the pipeline block that owns templateToml)` : String(crashed)}. ` +
          `The crash fires whenever the content pipeline changed nothing (no --model, nothing to strip): a pin-free ` +
          `custom template, a self-pinned one, and the model-less dropout-audit levy the bin escalates without ` +
          `--model. On BASE the same call materialized. The door's contract is an answer — ok or a coded refusal — ` +
          `and the handoff (data/review/lenses.txt, the ONE reader intake consumes) never lands.`,
      )
      assert.ok(
        !!ready && ready.ok && !("skipped" in ready && ready.skipped),
        `the model-less materialization must succeed: got ${JSON.stringify(ready)}`,
      )
      if (ready && ready.ok && !("skipped" in ready && ready.skipped)) {
        assert.ok(
          existsSync(join(ready.dir, "data", "review", "lenses.txt")),
          "the lens handoff must land beside the config (intake refuses without it)",
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // the same root cause on the diff's own feature path: the model-less
  // dropout audit (auditLevy, no --model) over a template whose pins
  // already have a model to ride — the strip arm is skipped, the
  // pipeline changes nothing, the handoff crashes the levy.
  test("a model-less dropout audit of a self-pinned template levies — it must not die on the lens handoff", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p39b-"))
    const out = join(tmp, "program")
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = selfPinnedTemplate(join(tmp, "tpl"))

      let ready: ReturnType<typeof prepareReview> | undefined
      let crashed: unknown
      try {
        ready = prepareReview(
          { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
          join(ROOT, "templates"),
        )
      } catch (err) {
        crashed = err
      }
      assert.ok(
        crashed === undefined,
        `INV-4/QUESTIONS #5 (break the new call: where does the error land?): the model-less dropout audit ` +
          `levy — the bin escalates audits WITHOUT --model by design (bin/whitehartlane:368-370) — crashed instead ` +
          `of levying: ${crashed instanceof Error ? crashed.message : String(crashed)}. The template's pins ride ` +
          `their own [workflow] model, the strip arm is skipped, the pipeline changes nothing, and the lenses.txt ` +
          `handoff (review.ts:669) evaluates the out-of-scope templateToml — ReferenceError, no ReviewReady, the ` +
          `audit the gate escalated dies at the door with a raw stack.`,
      )
      assert.ok(
        !!ready && ready.ok && !("skipped" in ready && ready.skipped),
        `the audited levy must materialize: got ${JSON.stringify(ready)}`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
