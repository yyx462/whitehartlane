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

function seedDocs(where: string): void {
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
}

function tplDir(where: string, toml: string): string {
  mkdirSync(where, { recursive: true })
  seedDocs(where)
  writeFileSync(join(where, "workflow.toml"), toml)
  return where
}

// A template whose lens units are declared [[stage.units]] (legal TOML
// the door's parse reads and materializes) and whose brief QUOTES a
// units block — review briefs quote TOML constantly (the corpus's own
// words: "review briefs quote TOML/shells all the time"). The quoted
// block's `units = [` line STARTS the line, exactly like a real block.
// The strip's block detector (review.ts:219
// /^[ \t]*["']?units["']?[ \t]*=[ \t]*\[/) matches lines inside
// multi-line STRING values too: the AOT form contributes no real
// `units = [` text line, so the quoted example is the ONLY match, the
// extent oracle closes it at the example's own `]`, the edit drops the
// quoted "questions" entry (not in the roster), and the example's
// lines are REWRITTEN inside the brief string. The roster verify
// passes (a quoted id was never a parsed unit), so ok:true ships a
// materialized lens whose brief no longer says what the author wrote
// — a silent mutation with no receipt, on the gate's normal subset
// path.
const QUOTED_CLOSED_EXAMPLE = [
  "[workflow]",
  `name = "t9101"`,
  `worker_kind = "opencode"`,
  "",
  "[[stage]]",
  `id = "lenses"`,
  `topology = "fan-out"`,
  "",
  "[[stage.units]]",
  `id = "principles"`,
  `brief = """lens law:`,
  `the roster is declared like so:`,
  `units = [`,
  `  { id = "questions", brief = "example entry" },`,
  `]`,
  `obey it"""`,
  "",
  "[[stage.units]]",
  `id = "tests"`,
  `brief = "t"`,
  "",
].join("\n")

// Same template, but the quoted example is UNCLOSED (a truncated
// paste). The extent oracle scans forward from the in-string line
// hunting a parseable `units` array, never finds one (the string's
// closing """ and the following [[stage.units]] lines cannot complete
// a parse), hits the 500-line ceiling, and stripUnitsToRoster returns
// null — the door refuses a template whose parse is FINE, blaming
// "no units block for roster subsetting" on a template whose units
// blocks (AOT) are right there.
const QUOTED_OPEN_EXAMPLE = [
  "[workflow]",
  `name = "t9101b"`,
  `worker_kind = "opencode"`,
  "",
  "[[stage]]",
  `id = "lenses"`,
  `topology = "fan-out"`,
  "",
  "[[stage.units]]",
  `id = "principles"`,
  `brief = """a truncated paste of the spell:`,
  `units = [`,
  `  { id = "questions", brief = "example entry" },`,
  `obey it"""`,
  "",
  "[[stage.units]]",
  `id = "tests"`,
  `brief = "t"`,
  "",
].join("\n")

function parsedUnitIds(toml: string): string[] {
  const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

test("control: the quoted-units template materializes verbatim with no roster", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9101-ctl-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", out: join(tmp, "prog"), template: tplDir(join(tmp, "tpl"), QUOTED_CLOSED_EXAMPLE) },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `premise: the door materializes the quoted-units template (got ${JSON.stringify(r).slice(0, 240)})`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.match(toml, /units = \[/, "the quoted example survives verbatim on the plain path")
      assert.match(toml, /id = "questions"/, "the quoted example's entry survives verbatim on the plain path")
      assert.deepEqual(parsedUnitIds(toml).sort(), ["principles", "tests"])
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the roster strip never rewrites a units example quoted INSIDE a brief string (closed example)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9101-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", roster: ["principles", "tests"], out: join(tmp, "prog"), template: tplDir(join(tmp, "tpl"), QUOTED_CLOSED_EXAMPLE) },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `the gate's subset of a door-legal template must materialize, got: ${JSON.stringify(r).slice(0, 240)}`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.deepEqual(
        parsedUnitIds(toml).sort(),
        ["principles", "tests"],
        `premise: the strip kept the roster's lens units (got ${JSON.stringify(parsedUnitIds(toml))})`,
      )
      assert.match(
        toml,
        /id = "questions"/,
        `the materialized lens brief must say what the author wrote: the quoted units example ` +
          `(a \`units = [\` line inside a multi-line string value) matches the strip's block detector ` +
          `(review.ts:219), the extent oracle closed it at the example's own \`]\`, and the edit DELETED ` +
          `the quoted entry from the brief — the roster path silently rewrote a lens's law with no refusal ` +
          `and no receipt (the verify passes because a quoted id was never a parsed unit). Text inside ` +
          `string values is not the strip's to edit.`,
      )
      assert.match(toml, /obey it"""/, "the brief's closing line must survive untouched")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("an unclosed quoted units example must not dead-end the roster subset with a false premise", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9101-open-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", roster: ["principles", "tests"], out: join(tmp, "prog"), template: tplDir(join(tmp, "tpl"), QUOTED_OPEN_EXAMPLE) },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `the strip must not refuse a parseable template: got ${JSON.stringify(r)}. An in-string ` +
        `"units = [" line with no closing bracket inside the string sends the extent oracle hunting past ` +
        `the string's terminator; finding no parseable array it returns null and the door answers ` +
        `"template has no units block for roster subsetting" — a false premise (the [[stage.units]] ` +
        `blocks are right there; the door's own parse reads both ids, as the control proves). The gate's ` +
        `normal subset path dead-ends on a template the door itself materializes roster-less.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// the SAME detector rides the audit strip (stripTemperaturePins arm 1,
// review.ts:380): a model-less dropout audit of an AOT template whose
// brief quotes a units example carrying a temperature key — the quoted
// example is matched as a units BLOCK, its temperature key is deleted
// INSIDE the brief string, and the materialized lens law is rewritten
// silently (ok:true; the verify is happy because a quoted key was
// never a parsed key).
const QUOTED_TEMP_EXAMPLE = [
  "[workflow]",
  `name = "t9101c"`,
  `worker_kind = "opencode"`,
  "",
  "[[stage]]",
  `id = "lenses"`,
  `topology = "fan-out"`,
  "",
  "[[stage.units]]",
  `id = "principles"`,
  `brief = """tune the roster entries:`,
  `units = [`,
  `  { id = "questions", temperature = 0.2, brief = "example entry" },`,
  `]`,
  `obey it"""`,
  "",
  "[[stage.units]]",
  `id = "tests"`,
  `brief = "t"`,
  "temperature = 0.4",
  "",
].join("\n")

test("the audit strip never rewrites a temperature example quoted INSIDE a brief string", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9101-audit-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", auditLevy: true, out: join(tmp, "prog"), template: tplDir(join(tmp, "tpl"), QUOTED_TEMP_EXAMPLE) },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `the model-less audit must materialize untuned (got ${JSON.stringify(r).slice(0, 240)})`,
    )
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
      assert.match(
        toml,
        /temperature = 0\.2, brief = "example entry"/,
        `the audit strip must edit KEYS, never string interiors: the quoted units example inside the ` +
          `principles brief matches the strip's block detector and its temperature mention was deleted ` +
          `from the brief — the audited lens's law silently rewritten, ok:true, no receipt (the verify ` +
          `passes because a quoted key was never a parsed key). Same detector fault as the roster path.`,
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
