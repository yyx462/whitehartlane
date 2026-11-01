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

// BASE shape guard (the tests-102 device): the model-less audit's
// temperature strip is this diff's own addition — on BASE there is no
// auditLevy and no strip, so the scenario is vacuous there.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripTemperaturePins")) {
  test("principles-35: BASE — no audit temperature strip, nothing to judge", () => {})
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

  // the door's own parsed read — does the document still pin temperature?
  function pinsLeft(tomlPath: string): boolean {
    const walk = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(walk)
      if (node && typeof node === "object") {
        return Object.entries(node as Record<string, unknown>).some(([k, v]) => k === "temperature" || walk(v))
      }
      return false
    }
    return walk(parseToml(readFileSync(tomlPath, "utf8")))
  }

  // INV-3 (one decision, one place — "how do pins leave a model-less
  // dropout audit"). The audit's untuned materialization must strip
  // every temperature pin the door's own parse can read — its verify
  // is the PARSE (hasTemperatureKey), but its ARM is a text matcher:
  // stripTemperaturePins only rewrites lines selected by /\{\s*id\s*=/
  // (review.ts) — the id must ride FIRST in the inline table. TOML
  // legalizes any key order, and the door's parse reads and
  // materializes a temperature-first entry ({ temperature = 0.2,
  // id = "principles" }) without a word — the same law this diff wrote
  // into intake.sh ("the reader must read what the door writes") and
  // the same incomplete-fix shape principles-34 pins for the roster
  // strip, in the SIBLING strip. For such a template the audit's
  // post-strip verify catches the survivor and REFUSES the audited
  // levy with "the strip regex missed a form … this is a door bug;
  // report it" — the dropout escalation (momentum-15's law: an audit
  // nobody runs measures nothing) dead-ends on a shape the door
  // itself blessed.
  test("a model-less dropout audit strips pins from every entry the door's parse reads — key order too", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p35-"))
    const out = join(tmp, "program")
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      seedDocs(tpl)
      writeFileSync(
        join(tpl, "workflow.toml"),
        [
          "[workflow]",
          `name = "p35"`,
          `worker_kind = "opencode"`,
          "",
          "[[stage]]",
          `id = "lenses"`,
          `topology = "fan-out"`,
          `units = [`,
          `  { temperature = 0.2, id = "principles", brief = "p" },`,
          `  { id = "tests", temperature = 0.7, brief = "t" },`,
          `]`,
          "",
        ].join("\n"),
      )

      // premise: the door's parse reads BOTH pins from these bytes —
      // the temperature-first entry is legal TOML the door materializes
      assert.equal(
        pinsLeft(join(tpl, "workflow.toml")),
        true,
        "premise: the door's own parse reads both temperature pins, the temperature-first one included",
      )
      // premise: with a model the same template materializes fine —
      // the shape is door-legal
      const withModel = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-model"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        withModel.ok && !("skipped" in withModel && withModel.skipped),
        `premise: the door materializes the temperature-first template when a model rides: ${JSON.stringify(withModel).slice(0, 200)}`,
      )

      // the law: the model-less audit levies UNTUNED — every pin the
      // parse reads leaves the bytes
      const r = prepareReview(
        { repo, base: "master", head: "feat", out, template: tpl, auditLevy: true, model: undefined },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3/momentum-15: the model-less dropout audit must LEVY untuned — but the strip's arm selects lines ` +
          `with /\\{\\s*id\\s*=\\// (id first, review.ts) while the door's parse reads any key order, so the ` +
          `temperature-first pin survived, the post-strip verify refused, and the audited escalation dead-ended ` +
          `(code ${String((r as { code?: number }).code)}): ${JSON.stringify((r as { why?: string }).why ?? "")}. ` +
          `No Job, no verdict, no label, no greens — the audit measures nothing while the ledger row claims ` +
          `action:"skip" + audit:true (the exact dead-end momentum-15's law forbids), one key order later than ` +
          `the form the strip was written for (tests-401 pinned the id-first form; the roster strip's spelling ` +
          `twin is principles-34). One decision — "how do pins leave a model-less audit" — answered by a parse ` +
          `and an arm that disagree.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        assert.equal(
          pinsLeft(join((r as { dir: string }).dir, "workflow.toml")),
          false,
          "the materialized audit program carries no temperature pin (the receipt says untuned)",
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
