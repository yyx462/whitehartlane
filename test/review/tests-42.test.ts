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

// gate-r29 tests-42: the pin arm's header candidate tried ONE landing
// (the first model-looking line — inside a multi-line doc string) and
// never fell back to insert-under-header when the replace failed the
// parse-verify, refusing a legal [workflow] table with a false
// premise. Every landing for the header, until one verifies.
test("the pin lands in a [workflow] table whose doc string quotes a line-initial model example", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t42-"))
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
        `name = "t42"`,
        `worker_kind = "opencode"`,
        `notes = """`,
        `the pin form this table documents:`,
        `model = "example, not live config"`,
        `"""`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = "tests", brief = "t" },`,
        `]`,
        "",
      ].join("\n"),
    )
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "program"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !("skipped" in r && r.skipped), `the door must materialize — the [workflow] table is one of the refusal's own named forms: ${JSON.stringify(r).slice(0, 220)}`)
    const mat = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
      workflow?: { model?: string; notes?: string }
    }
    assert.equal(mat.workflow?.model, "acme/strong", "the pin landed where the consumer reads it")
    assert.match(String(mat.workflow?.notes), /model = "example, not live config"/, "the quoted example survives verbatim — never the replace's to edit")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
