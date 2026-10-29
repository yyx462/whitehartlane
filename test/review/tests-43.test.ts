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

function templateDir(where: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t43"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      "[[stage.units]]",
      `id = "principles"`,
      // a bracket-initial example line INSIDE the brief string: the old
      // raw next-header extent scan cut the block mid-string here
      `brief = """`,
      `the shape this program documents:`,
      `  [workflow]`,
      `is an example table header.`,
      `"""`,
      // the REAL pin sits AFTER the string — outside the old cut
      "temperature = 0.2",
      "",
      "[[stage.units]]",
      `id = "tests"`,
      `brief = "t"`,
      "",
    ].join("\n"),
  )
  return where
}

// gate-r29 tests-43: the temperature strip's [[stage.<array>]] arm
// computed its block extent with a raw bracket-prefix scan — unlike
// its roster twin, whose extent candidates are parse-checked — so a
// brief quoting a bracket-initial example line cut the extent
// mid-string, the real pin after the string survived the strip, and
// the model-less dropout audit dead-ended at its own verify ('this is
// a door bug'): no Job, no verdict, the dropout measuring nothing.
// THE PARSE IS THE EXTENT ORACLE HERE TOO.
test("the audit's temperature strip survives a bracket-initial example line inside a brief string", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t43-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateDir(join(tmp, "tpl"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "program"), template: tpl, auditLevy: true },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped) && "dir" in r && !!r.dir,
      `the model-less dropout audit must levy untuned — the parse-verified extent covers the whole block: ${JSON.stringify(r).slice(0, 220)}`,
    )
    const mat = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<Record<string, unknown>> }>
    }
    const entries = (mat.stage ?? []).flatMap((s) => s.units ?? [])
    for (const e of entries) {
      assert.ok(!("temperature" in e), `the pin was dropped wherever it sat in the block (got temperature on ${JSON.stringify(e.id)})`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
