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

// BASE shape: the marker-delimited derivation is this diff's own
// addition — on BASE intake.sh hardcodes the four canonical lenses and
// there is no derivation block (and no twin law), so nothing is judged.
const INTAKE = join(ROOT, "templates", "pr-review", "hooks", "intake.sh")

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

function templateDir(where: string, unitsToml: string): string {
  mkdirSync(where, { recursive: true })
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "p31"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      unitsToml,
      "",
    ].join("\n"),
  )
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  return where
}

// intake.sh's exact lens derivation (the marker-delimited block),
// extracted verbatim — the same harness principles-26/momentum-22
// adopted ("the test runs these exact bytes")
function deriveLenses(programDir: string): string[] {
  const block = readFileSync(INTAKE, "utf8").split("# :lens-derivation-start")[1]?.split("# :lens-derivation-end")[0]
  assert.ok(block, "sanity: intake.sh carries the marker-delimited lens derivation")
  const out = execFileSync(
    "bash",
    ["-c", `prog=${JSON.stringify(programDir)}\n${block}\nprintf '%s\\n' $lenses`],
    { encoding: "utf8" },
  )
  return out.trim().split("\n").filter(Boolean)
}

// the door's own parsed read of the same bytes
function parsedUnitIds(programDir: string): string[] {
  const parsed = parseToml(readFileSync(join(programDir, "workflow.toml"), "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

// INV-3 (one decision, one place — "which lens units did this program
// materialize?") / the derivation's own twin law, written in this
// diff's bytes: "the door's parsed reader accepts and materializes it;
// the textual reader must derive the same lenses or every lens
// silently loses its shuffled hunk order."
//
// gate-r8/momentum-22 widened the id CHARSET to [a-z][a-z0-9_-]* — but
// the derivation's two textual arms are still spelling-EXACT around the
// id: the sed+grep arm matches only `{ id = "` (one space, double
// quote) and the awk arm only `^id = "` (double quote). TOML — which
// the door's own parser reads, whose ids the run path executes — also
// accepts `{id = "sec"}` (no padding) and `{ id = 'sec' }` (literal
// string). For such a template BOTH arms match nothing, the loop
// iterates over nothing, ZERO order-<lens>.txt files are written, and
// intake still prints "intake ok": every lens silently reads
// diff.patch in the IDENTICAL order — the correlated first-attention
// the shuffle exists to kill (the principles-14 receipt class), with
// no refusal and no receipt, on a template the door materialized
// without a word.
test("intake's lens derivation reads every unit id the door's parse materializes, whatever TOML spelling carries it", () => {
  const intake = readFileSync(INTAKE, "utf8")
  if (!intake.includes("# :lens-derivation-start")) return // BASE: no derivation — nothing to judge

  // premise: the door's own id validator ACCEPTS these ids — the run
  // path executes them (hooks.ts SHEP_SAFE_ID)
  const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/
  assert.ok(
    SHEP_SAFE_ID.test("sec") && SHEP_SAFE_ID.test("loose"),
    "premise: SHEP_SAFE_ID legalizes the ids under test (the run path executes them)",
  )

  for (const [label, unitsToml] of [
    [
      // legal TOML: zero padding inside the inline table
      "the unpadded inline entry ({id = \"sec\"})",
      ["units = [", `  {id = "sec", brief = "tight"},`, "]", ""].join("\n"),
    ],
    [
      // legal TOML: literal (single-quoted) string
      "the single-quoted literal string ({ id = 'loose' })",
      ["units = [", `  { id = 'loose', brief = "single-quoted" },`, "]", ""].join("\n"),
    ],
  ] as [string, string][]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p31-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = templateDir(join(tmp, "tpl"), unitsToml)

      // premise: the door's own parse reads the id from these bytes —
      // the shape is legal TOML the run-time accepts
      const parsedTpl = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const tplIds = (parsedTpl.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.equal(tplIds.length, 1, `premise (${label}): smol-toml — the door's own parser — reads the unit id (${JSON.stringify(tplIds)})`)

      const ready = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        ready.ok && !("skipped" in ready && ready.skipped),
        `premise (${label}): the door MATERIALIZES this template without a word (got ${JSON.stringify(ready).slice(0, 200)})`,
      )
      const dir = (ready as { dir: string }).dir
      const parsed = parsedUnitIds(dir)
      assert.deepEqual(
        [...parsed].sort(),
        [...tplIds].sort(),
        `premise (${label}): the materialized bytes carry the unit id the door's parse reads`,
      )
      const derived = deriveLenses(dir)
      assert.deepEqual(
        [...derived].sort(),
        [...parsed].sort(),
        `INV-3 (${label}): "which lens units did this program materialize" is answered by TWO readers after ` +
          `this diff — the door's parse (charset- AND spelling-permissive: it materialized ${JSON.stringify(parsed)} ` +
          `and the run path executes them) and intake.sh's derivation (intake.sh:96 grep -o '{ id = "[a-z][a-z0-9_-]*"' ` +
          `and intake.sh:102 awk /^id = "[a-z][a-z0-9_-]*"/ — both DOUBLE-QUOTE- and PADDED-SPACE-exact). ` +
          `The derivation produced ${JSON.stringify(derived)}: the loop writes ZERO order-<lens>.txt files, intake still ` +
          `prints "intake ok", and every lens silently reads diff.patch in the IDENTICAL order — the correlated ` +
          `first-attention the shuffle exists to kill (the principles-14 receipt class), with no refusal and no ` +
          `receipt. The derivation's own twin law ("the textual reader must derive the same lenses or every lens ` +
          `silently loses its shuffled hunk order") is false for the TOML spellings the door's own parser accepts. ` +
          `Derive what the parse reads (parse the document, or widen the textual arms to every spelling smol-toml ` +
          `accepts), or refuse the shape — never a silent zero-order review.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
