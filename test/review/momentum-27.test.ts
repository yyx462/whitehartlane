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

// BASE shape guard (the tests-102 device): the roster strip is this
// diff's own addition — on BASE there is no roster handling, nothing
// to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("momentum-27: BASE — no roster strip, nothing to judge", () => {})
} else {
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

  // INV-3 (one decision, one place — "which unit entries does the roster
  // keep?"): the door's own parse reads EVERY `units` block in the
  // document (stage[] is an array; each fan-out stage carries its own
  // units). stripUnitsToRoster's multi-line arm returns after the FIRST
  // `units = [` block it strips, so a chain with TWO fan-out stages —
  // legal at the door (loadManifest validates each [[stage]] on its own;
  // no stage-count rule exists) — keeps its SECOND stage's units
  // untouched. The post-verify then counts them as strays and refuses
  // with "roster subsetting failed post-verify … (this is a door bug;
  // report it)": the gate's roster decision dead-ends on a template the
  // door itself materializes without a word, and the message names the
  // wrong culprit (the strip is the site that stopped early).
  test("the roster strip reads every units block the door's parse reads — not just the first", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m27-"))
    const out = join(tmp, "program")
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
          `name = "m27"`,
          `worker_kind = "opencode"`,
          "",
          "[[stage]]",
          `id = "wave1"`,
          `topology = "fan-out"`,
          `units = [`,
          `  { id = "principles", brief = "first wave" },`,
          `]`,
          "",
          "[[stage]]",
          `id = "wave2"`,
          `topology = "fan-out"`,
          `units = [`,
          `  { id = "tests", brief = "second wave" },`,
          `]`,
          "",
        ].join("\n"),
      )

      // premise 1: the door's own parse reads BOTH stages' units
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...ids].sort(),
        ["principles", "tests"],
        "premise: smol-toml — the door's own parser — reads both fan-out stages' units",
      )

      // premise 2: without a roster the door MATERIALIZES this template
      // without a word — the shape is door-legal
      const plain = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-plain"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        plain.ok && !("skipped" in plain && plain.skipped),
        `premise: the door materializes this two-fan-out-stage template with no roster: ${JSON.stringify(plain).slice(0, 200)}`,
      )

      // the law: the gate's roster decision is servable on every shape
      // the door's own parse reads — roster [principles] keeps
      // principles, drops tests, materializes fine
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.equal(
        r.ok,
        true,
        `INV-3: "which unit entries does the roster keep?" is answered by TWO readers that disagree after this ` +
          `diff: the door's parse (stage[] is an array — it reads EVERY units block) and stripUnitsToRoster ` +
          `(its multi-line arm returns after the FIRST units block it strips). On a two-fan-out-stage template ` +
          `— legal at the door, materialized without a word when no roster rides — the second stage's units ` +
          `survive the strip, the post-verify counts them as strays, and the door refuses the gate's roster ` +
          `decision with "roster subsetting failed post-verify … (this is a door bug; report it)": ` +
          `ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}, why=${JSON.stringify((r as { why?: string }).why ?? "")}. ` +
          `The roster feature dead-ends on a template class the door itself blesses, and the refusal names the ` +
          `wrong site (the strip stopped early — it is not a parse failure). Strip every units block, or refuse ` +
          `up front naming the real limit.`,
      )
      if (r.ok && !("skipped" in r && r.skipped)) {
        const kept = (parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
          stage?: Array<{ units?: Array<{ id?: string }> }>
        }).stage ?? []
        assert.deepEqual(
          kept.flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean).sort(),
          ["principles"],
          "the materialized subset carries only the roster's lens",
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
