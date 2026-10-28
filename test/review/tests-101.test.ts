import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// THE SILENT HALF of the roster-strip fault (tests-100 pins the model
// path, where the post-verify safety net at least refuses). Without
// --model the pin-plan block never runs, so the "roster subsetting
// failed post-verify" screen never fires either — and stripUnitsToRoster
// is a SILENT NO-OP on a single-line inline units array: its end-scan
// runs to EOF and its kept-lines filter re-inserts every line it cannot
// parse as a unit entry, so the materialization-time re-strip writes
// the pristine bytes back. The materialized "subset" program carries
// ALL FOUR lens units while the gate decided two — the gate's roster
// decision is silently inverted, with no refusal and no verify (the
// roster's only post-check lives inside the model branch). The door's
// own contract: "a subset materializes ONLY those lens units".
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

function inlineUnitsTemplateNoTemp(where: string): string {
  mkdirSync(where, { recursive: true })
  writeFileSync(join(where, "REVIEWER.md"), "# reviewer law\n")
  writeFileSync(join(where, "SCHEMA.md"), "# schema\n")
  writeFileSync(join(where, "INVARIANTS.template.md"), "# invariants seed\n")
  writeFileSync(join(where, "QUESTIONS.template.md"), "# questions seed\n")
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t101"`,
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

test("the no-model roster strip must not silently materialize every lens unit of an inline units block", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests101-"))
  const out = join(tmp, "program")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = inlineUnitsTemplateNoTemp(join(tmp, "tpl"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", roster: ["principles", "tests"], out, template: tpl },
      join(ROOT, "templates"),
    )
    assert.equal(r.ok, true, `materialization itself must succeed: ${r.ok ? "" : (r as { why?: string }).why}`)
    if (r.ok) {
      const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.doesNotMatch(
        toml,
        /id = "momentum"/,
        `the gate's roster ["principles","tests"] was silently IGNORED: the materialized program still ` +
          `spawns all four lens units. stripUnitsToRoster no-ops on an inline units array (the kept-lines ` +
          `filter re-inserts the whole block) and the no-model path has no post-verify to catch the strays ` +
          `— the gate decided two lenses and the door materialized four, the decision inverted with no ` +
          `receipt. The door's own contract: "a subset materializes ONLY those lens units".`,
      )
      assert.doesNotMatch(toml, /id = "questions"/)
      assert.match(toml, /id = "principles"/)
      assert.match(toml, /id = "tests"/)
      assert.match(toml, /id = "merge"/, "the later stages must survive the strip")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
