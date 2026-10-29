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

// Meta-ACH: the value class nobody tested — a TOML DATE (smol-toml, the
// door's own parser, hands back a Date object for `2026-01-15`). Every
// re-serialization arm the diff built (inlineTomlValue, the shared
// "TOTAL inline serializer") enumerates strings, numbers, booleans,
// arrays, and plain objects — a Date falls into the plain-object branch,
// Object.entries(Date) is [], and the field is re-serialized as an EMPTY
// inline table `{  }`. Not undefined (which per the strip's own contract
// — "returns null when … a value cannot be re-serialized" — would refuse
// honestly): a silent rewrite. The parse-verify backstops only the
// FIELDS the pipeline cares about (ids, temperature, workflow.model), so
// the corrupted bytes sail every verify and are materialized as the
// program the gate approved-with-a-date. The door's own law is
// text-preserving materialization ("the template's inline units
// survive verbatim"; refuse when a value cannot be re-serialized).
// Introduced by this diff (BASE rewrote nothing; the roster/audit strips
// are new). No diff test feeds a date through any strip arm.

// 1) the roster strip's units rebuild (the gate's subset materialization)
test("the roster strip preserves a unit's TOML date field — it must not re-serialize it into an empty table", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9002a-"))
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
        `name = "t9002a"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p", not_before = 2026-01-15 },`,
        `  { id = "tests", brief = "t" },`,
        `]`,
        "",
      ].join("\n"),
    )

    // premise: the door's own parse reads not_before as a DATE — a value
    // shape the consumer parses fine; nothing is malformed here
    const parsedTpl = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<Record<string, unknown>> }>
    }
    const first = parsedTpl.stage?.[0]?.units?.[0]
    assert.ok(first?.not_before instanceof Date, "premise: smol-toml reads not_before as a TOML date")

    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out, template: tpl },
      join(ROOT, "templates"),
    )
    // either the door refuses honestly (naming the unserializable value),
    // or the materialized bytes still carry the date for the consumer
    if (!r.ok || ("skipped" in r && r.skipped) || !("dir" in r) || !r.dir) {
      assert.ok(
        !r.ok && /not_before|date|re-serializ/i.test(String((r as { why?: string }).why ?? "")),
        `if the door refuses, the refusal must name the real premise (the unserializable date value), not ` +
          `"no units block"/"strip regex missed a form": got ${JSON.stringify(r).slice(0, 240)}`,
      )
      return
    }
    const mat = parseToml(readFileSync(join(r.dir, "workflow.toml"), "utf8")) as {
      stage?: Array<{ units?: Array<Record<string, unknown>> }>
    }
    const kept = (mat.stage ?? []).flatMap((s) => s.units ?? []).find((u) => u.id === "principles")
    assert.ok(
      kept?.not_before instanceof Date && new Date("2026-01-15").getTime() === (kept.not_before as Date).getTime(),
      `INV-2 (refuse, never vanish) / the strip's own contract ("returns null when … a value cannot be ` +
        `re-serialized"): the kept unit's not_before was a TOML date (2026-01-15) in the template the gate ` +
        `approved; the materialized program carries ${JSON.stringify(kept?.not_before)} — inlineTomlValue's ` +
        `plain-object branch (Object.entries(Date) = []) re-serialized the date into an empty inline table, ` +
        `the parse-verify blessed it (it checks only ids/temperature/model), and the door returned ok:true. ` +
        `The gate's subset materialization silently rewrote a declared field into garbage instead of refusing ` +
        `the value class it cannot re-serialize. Found in no diff test: every strip-arm fixture feeds only ` +
        `strings and numbers.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// 2) the model pin's single-line inline-workflow arm (the same shared
// serializer, one seat over)
test("the inline-workflow pin arm preserves a TOML date field in the table it rebuilds", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9002b-"))
  const out = join(tmp, "program")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    seedDocs(tpl)
    // [workflow] declared as a single-line inline table — the exact form
    // pinIntoWorkflowTable's arm 3 rebuilds from the parse — carrying a
    // date field alongside the scalars
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        `workflow = { name = "t9002b", worker_kind = "opencode", opens = 2026-01-15 }`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [ { id = "principles", brief = "p" } ]`,
        "",
      ].join("\n"),
    )

    const parsedTpl = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
      workflow?: Record<string, unknown>
    }
    assert.ok(parsedTpl.workflow?.opens instanceof Date, "premise: smol-toml reads workflow.opens as a TOML date")

    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    if (!r.ok || ("skipped" in r && r.skipped) || !("dir" in r) || !r.dir) {
      assert.ok(
        !r.ok && /opens|date|re-serializ/i.test(String((r as { why?: string }).why ?? "")),
        `if the door refuses, the refusal must name the real premise (the unserializable date), not ` +
          `"no [workflow] table": got ${JSON.stringify(r).slice(0, 240)}`,
      )
      return
    }
    const mat = parseToml(readFileSync(join(r.dir, "workflow.toml"), "utf8")) as {
      workflow?: Record<string, unknown>
      stage?: Array<{ units?: Array<{ id?: string }> }>
    }
    // (the pin's landing itself is pinned by gate-r20's own repros; on
    // BASE this template was never pinned — the judged assertion below
    // is the date's survival, green on BASE either way)
    assert.ok(
      mat.workflow?.opens instanceof Date && new Date("2026-01-15").getTime() === (mat.workflow.opens as Date).getTime(),
      `INV-2 (refuse, never vanish) / the pin arm's own law ("the ONE line is rebuilt from the parse … ` +
        `everything else in the document survives verbatim"): the inline [workflow] table's opens was a TOML ` +
        `date (2026-01-15); the rebuilt line carries ${JSON.stringify(mat.workflow?.opens)} — the shared ` +
        `serializer turned the date into an empty inline table and the parse-verify (model only) blessed the ` +
        `materialization. The door rewrote a declared field into garbage with ok:true instead of refusing the ` +
        `value class it cannot re-serialize.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
