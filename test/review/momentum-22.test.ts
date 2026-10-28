import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
      `name = "m22"`,
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

// intake.sh's exact lens derivation (intake.sh:92-95), extracted
// verbatim from the marker-delimited block — the same harness
// principles-26 adopted ("the test runs these exact bytes")
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
// materialize?") / INV-4 (the derivation's own comment: "the roster is
// the materialized units … this reads the truth instead").
//
// The door's OWN validator accepts ids the derivation cannot see:
// SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/ (hooks.ts:521, enforced at
// hooks.ts:112/266) — "lens1" is a legal unit id the run path executes.
// The derivation's two textual arms (intake.sh:96 sed+grep, intake.sh:102
// awk) match only [a-z]* — a digit-bearing id is invisible to BOTH, the
// loop iterates over nothing, and ZERO order-<lens>.txt files are
// written while intake still prints "intake ok": every lens of that
// review silently reads diff.patch in the IDENTICAL order — the exact
// correlated-attention failure the shuffle exists to kill (the
// principles-14 receipt class), on a template the door materialized
// without a word. The diff's own adopted law (principles-26) says the
// reader must derive what the door's parse reads, or the door must
// refuse shapes the reader cannot derive; it does neither for the
// charset SHEP_SAFE_ID legalizes.
test("intake's lens derivation reads every unit id the door's own validator accepts (digit-bearing ids)", () => {
  const intake = readFileSync(INTAKE, "utf8")
  if (!intake.includes("# :lens-derivation-start")) return // BASE: no derivation — nothing to judge

  // premise: the door's own id validator ACCEPTS digit-bearing ids —
  // the run path executes them (hooks.ts:266 SHEP_SAFE_ID)
  const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/
  assert.ok(
    SHEP_SAFE_ID.test("lens1") && SHEP_SAFE_ID.test("lens2"),
    "premise: SHEP_SAFE_ID legalizes digit-bearing unit ids (the run path executes them)",
  )

  for (const [label, unitsToml] of [
    [
      // the shipped template's own shape: multi-line inline units array
      "the multi-line units = [ … ] array (the pr-review template's own form)",
      [
        "units = [",
        `  { id = "lens1", brief = "first" },`,
        `  { id = "lens2", brief = "second" },`,
        "]",
        "",
      ].join("\n"),
    ],
    [
      // the [[stage.units]] array-of-tables form (principles-26's blessed shape)
      "the [[stage.units]] array-of-tables form (the shape principles-26 blessed)",
      [
        "[[stage.units]]",
        `id = "lens1"`,
        `brief = "first"`,
        "[[stage.units]]",
        `id = "lens2"`,
        `brief = "second"`,
        "",
      ].join("\n"),
    ],
  ] as [string, string][]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m22-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = templateDir(join(tmp, "tpl"), unitsToml)
      const ready = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        ready.ok && !("skipped" in ready && ready.skipped),
        `premise: the door materializes the ${label} with digit-bearing unit ids (got ${JSON.stringify(ready).slice(0, 200)})`,
      )
      const dir = (ready as { dir: string }).dir
      const parsed = parsedUnitIds(dir)
      assert.deepEqual(
        [...parsed].sort(),
        ["lens1", "lens2"],
        `premise (${label}): the door's own parse reads both digit-bearing units from the materialized bytes`,
      )
      const derived = deriveLenses(dir)
      assert.deepEqual(
        [...derived].sort(),
        [...parsed].sort(),
        `INV-3/INV-4 (${label}): "which lens units did this program materialize" is answered by TWO readers after ` +
          `this diff — the door's parse (charset-permissive; its own validator SHEP_SAFE_ID ` +
          `/^[a-z][a-z0-9_-]{0,31}$/ accepted ids "${parsed.join('", "')}") and intake.sh's derivation ` +
          `(intake.sh:96 grep -o '{ id = "[a-z]*"' and intake.sh:102 awk /^id = "[a-z]*"/ — [a-z]* only). ` +
          `The materialized program's units are ${JSON.stringify(parsed)} but the derivation produced ` +
          `${JSON.stringify(derived)}: the loop writes ZERO order-<lens>.txt files, intake still prints "intake ok", ` +
          `and every lens silently reads diff.patch in the IDENTICAL order — the correlated first-attention the ` +
          `shuffle exists to kill (the principles-14 receipt class), with no refusal and no receipt. The ` +
          `derivation's own comment claims "this reads the truth instead"; for the ids the door's own validator ` +
          `legalizes it reads nothing. Derive what the parse reads (match SHEP_SAFE_ID), or refuse the shape.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
