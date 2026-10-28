import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// THE ROSTER STRIP vs the one template form the door's own law blesses.
// The pin-plan's hard-won rule (the diff's own comment, review.ts
// "r20 principles-12/tests-30/tests-31: EVERY … question is answered
// by the consumer's own smol-toml read … never by a table-blind
// regex") blesses "whatever form declares it … a literal header,
// dotted keys, an inline table". stripUnitsToRoster (review.ts, the
// roster half of the same door) never got that law: on a single-line
// inline units array — legal TOML, parsed fine by the door's own
// smol-toml read — its end-scan runs to EOF and its kept-lines filter
// re-inserts every line after the block, so the strip is a SILENT
// NO-OP: all four lens units survive. On the pin path the post-verify
// safety net catches the strays and REFUSES — blaming the TEMPLATE
// with "this is a door bug; the roster was pre-flight" for exactly the
// shape the strip declined to handle. A gate-decided subset review of
// a legal template cannot be materialized at all.
//
// This file pins the MODEL path: a gate roster + --model against a
// template whose units block is one inline line must materialize a
// subset program. On HEAD it refuses with code 2 instead.
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

function inlineUnitsTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  // the door copies these into data/ — on BASE (no roster handling)
  // materialization proceeds and the repro must fail on its ASSERTION
  // (incomplete-fix), never on a missing-fixture crash (base-infra)
  writeFileSync(join(where, "REVIEWER.md"), "# reviewer law\n")
  writeFileSync(join(where, "SCHEMA.md"), "# schema\n")
  writeFileSync(join(where, "INVARIANTS.template.md"), "# invariants seed\n")
  writeFileSync(join(where, "QUESTIONS.template.md"), "# questions seed\n")
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t100"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "intake"`,
      `topology = "gate"`,
      `run = "true"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      // ONE LINE — the exact shape the pin-plan's arm 3 blesses for the
      // workflow table ("a single-line inline table — that ONE line is
      // rebuilt from the parse"). The units strip has no such arm.
      `units = [ { id = "principles", brief = "p" }, { id = "tests", brief = "t" }, { id = "momentum", brief = "m" }, { id = "questions", brief = "q" } ]`,
      "",
      "[[stage]]",
      `id = "merge"`,
      `topology = "gate"`,
      `run = "true"`,
      "",
    ].join("\n"),
  )
  return where
}

test("a gate roster against a legal inline-units template materializes the subset — it must not refuse", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests100-"))
  const out = join(tmp, "program")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = inlineUnitsTemplate(join(tmp, "tpl"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests"], out, template: tpl },
      join(ROOT, "templates"),
    )
    assert.equal(
      r.ok,
      true,
      `the door refuses a template its own parser accepts: ok=${String(r.ok)} code=${r.ok ? "-" : String((r as { code?: number }).code)} why=${r.ok ? "-" : (r as { why?: string }).why}. ` +
        `stripUnitsToRoster silently no-ops on an inline units block (its kept-lines filter re-inserts every ` +
        `line it cannot parse as a unit), all four lens ids survive, and the pin path's post-verify then ` +
        `refuses the materialization with "this is a door bug; the roster was pre-flight" — blaming the ` +
        `TEMPLATE for the one form the strip declined to handle. The pin-plan's own law — every form the ` +
        `consumer parses must land — was never extended to the roster strip.`,
    )
    if (r.ok) {
      const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.match(toml, /id = "merge"/, "the later stages must survive the roster strip")
      assert.doesNotMatch(toml, /id = "momentum"/)
      assert.doesNotMatch(toml, /id = "questions"/)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
