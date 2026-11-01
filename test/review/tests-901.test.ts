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

// BASE shape: the roster strip is this diff's own addition — nothing to
// judge there (the tests-102 device).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")) {
  test("tests-901: BASE — no roster strip, nothing to judge", () => {})
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

  // INV-2/INV-3/INV-4 — the gate's roster subset decision, silently
  // inverted. stripUnitsToRoster's SINGLE-LINE inline arm re-derives
  // which stage it is sitting in by counting headers that match
  // /^\[\[?stage\]?\]/ — anchored at column 0 with NO interior spaces.
  // `[[ stage ]]` is legal TOML (whitespace may surround the key in a
  // table header) and the door's own parse reads it into stage[] — the
  // same parse the roster post-verify runs. For a template whose SECOND
  // stage carries the spaced header, the counter misses it, stageIdx
  // lands one stage EARLY, and the arm rebuilds the second stage's
  // units line FROM THE FIRST STAGE'S PARSED UNITS: the second stage's
  // real units vanish, replaced by a copy of the first stage's kept
  // set. The strays check passes (no id outside the roster survives),
  // survivors > 0, ok:true — a materialized program that runs the
  // first stage's units TWICE and never runs the rostered units the
  // gate decided on, with no refusal and no receipt.
  test("the roster strip serves every stage its OWN units — a spaced stage header must not misindex the rebuild", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t901-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      mkdirSync(tpl, { recursive: true })
      for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
        writeFileSync(join(tpl, doc), "# seed\n")
      }
      const toml = [
        "[workflow]",
        `name = "t901"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "wave1"`,
        `topology = "fan-out"`,
        `units = [ { id = "principles", brief = "p" } ]`,
        "",
        "[[ stage ]]", // interior spaces — legal TOML, parse reads it
        `id = "wave2"`,
        `topology = "fan-out"`,
        `units = [ { id = "tests", brief = "t" }, { id = "momentum", brief = "m" } ]`,
        "",
      ].join("\n")
      writeFileSync(join(tpl, "workflow.toml"), toml)

      // PREMISE — the consumer's own read: two stages, each with its own
      // units, the second header spaced.
      const parsed = parseToml(toml) as { stage?: Array<{ id?: string; units?: Array<{ id?: string }> }> }
      assert.deepEqual(
        parsed.stage?.map((s) => ({ id: s.id, units: s.units?.map((u) => u.id) })),
        [
          { id: "wave1", units: ["principles"] },
          { id: "wave2", units: ["tests", "momentum"] },
        ],
        "premise: smol-toml — the door's own parser — reads both spaced/canonical stages with their own units",
      )

      // the roster names EVERY unit (length 3 < 4, so the strip runs):
      // a faithful strip changes nothing but the byte shapes — every
      // stage keeps its own units.
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests", "momentum"], out, template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `sanity: the door materializes the roster (all units kept): ${JSON.stringify(r)}`,
      )
      const mat = parseToml(readFileSync(join(r.dir, "workflow.toml"), "utf8")) as {
        stage?: Array<{ id?: string; units?: Array<{ id?: string }> }>
      }
      assert.deepEqual(
        mat.stage?.map((s) => ({ id: s.id, units: s.units?.map((u) => u.id) })),
        [
          { id: "wave1", units: ["principles"] },
          { id: "wave2", units: ["tests", "momentum"] },
        ],
        `INV-2/INV-3/INV-4 (the gate's roster decision must be served, never silently inverted): the ` +
          `strip's single-line arm counts [[stage]] headers with /\\[\\[?stage\\]?\\]/ — no interior ` +
          `spaces — so the legal second header "[[ stage ]]" (the premise shows the door's own parse ` +
          `reads both stages) was missed and stageIdx landed one stage EARLY: the arm rebuilt wave2's ` +
          `units line FROM wave1's parsed units. Materialized stages: ` +
          `${JSON.stringify(mat.stage?.map((s) => ({ id: s.id, units: s.units?.map((u) => u.id) })))} — ` +
          `wave2's real units ["tests","momentum"] VANISHED, replaced by a copy of wave1's ["principles"] ` +
          `(a unit run twice by two stages), the roster the gate decided silently truncated to one lens, ` +
          `ok:true, no strays (the check cannot see a stage lose its own units), no refusal, no receipt. ` +
          `The strip must index the stage it is rewriting the way the consumer does — by the parse, not by ` +
          `a column-0 header counter.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
