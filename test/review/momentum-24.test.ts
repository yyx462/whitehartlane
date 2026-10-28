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
const INTAKE = join(ROOT, "templates", "pr-review", "hooks", "intake.sh")

// MOMENTUM (timing/ordering of the review's own long trace): the hunk
// order files are what de-correlate the four lenses — the brief sends
// every lens to `review/order-<lens>.txt` (workflow.toml preamble),
// and a lens with no order file reads diff.patch in the shared native
// order. intake.sh's derivation is this diff's replacement for the
// BASE hardcoded roster; its own comment states the law: "the roster
// is the materialized units, never the hardcoded four … this reads
// the truth instead."
//
// The door's materialization is TEXT-PRESERVING by design (gate-r1
// momentum-1: the parse→stringify landing rewrote the units layout and
// the derivation matched nothing — the fix was to never rewrite). So
// whatever LEGAL TOML spelling the template uses for the units array
// reaches the materialized bytes verbatim on the full-roster path.
// The derivation's sed anchor (`/^[ \t]*units = \[/`) pins ONE
// spelling: exactly one space on each side of `=`. TOML legalizes
// `units =[` (whitespace around a key/value separator is optional) —
// smol-toml parses it, the door materializes it, the units run — and
// the sed range never opens, so the derivation yields ZERO lenses and
// writes ZERO order files: every lens of that review silently reads
// the diff in the IDENTICAL order, the correlated first-attention the
// shuffle exists to kill (the principles-14 receipt class), with no
// refusal and no receipt. Same root as the roster strip's
// `unitsLine = /^[ \t]*units = \[/` (review.ts), which refuses a
// roster subset on such a template with "no units block" — the parse
// proves the block exists. INV-3: "which lens units did this program
// materialize" is answered by TWO readers (the door's parse;
// intake's text scan) that disagree on the forms TOML legalizes.
// Charset (momentum-22), indents, quotes, and [[stage.units]] were
// hardened (gate-r10); the separator spelling was not.

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

// the shipped template's own shape, with ONE byte changed: `units =[`
// (no space before the bracket). Legal TOML; normal [a-z] lens ids —
// the LAYOUT spelling is the only variable under test.
function tightTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "m24"`,
      `worker_kind = "opencode"`,
      `stall_ms = 1800000`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "units =[",
      `  { id = "principles", temperature = 0.2, brief = "p" },`,
      `  { id = "tests", temperature = 0.4, brief = "t" },`,
      `  { id = "momentum", temperature = 0.6, brief = "m" },`,
      `  { id = "questions", temperature = 0.8, brief = "q" },`,
      "]",
      "",
    ].join("\n"),
  )
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  return where
}

// intake.sh's exact lens derivation, extracted verbatim from the
// marker-delimited block (the same harness momentum-22/principles-26
// adopted — "the test runs these exact bytes")
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

test("intake's lens derivation reads the tight-bracket units array the door materializes verbatim", () => {
  const intake = readFileSync(INTAKE, "utf8")
  if (!intake.includes("# :lens-derivation-start")) return // BASE: hardcoded roster — nothing to judge

  // premise: `units =[` is legal TOML — the consumer's own parser
  // accepts it (if this throws, the whole finding is moot)
  const tplToml = readFileSync(join(import.meta.dirname, "momentum-24.test.ts"), "utf8")
  assert.ok(tplToml.includes('"units =["'), "sanity: the fixture under test uses the tight spelling")

  const tmp = mkdtempSync(join(tmpdir(), "whl-m24-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = tightTemplate(join(tmp, "tpl"))
    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door materializes the tight-bracket template (got ${JSON.stringify(ready).slice(0, 200)})`,
    )
    const dir = (ready as { dir: string }).dir
    const toml = readFileSync(join(dir, "workflow.toml"), "utf8")
    assert.ok(
      toml.includes("units =["),
      "premise: the door's materialization is text-preserving — the tight spelling reaches the staged bytes",
    )
    const parsed = parsedUnitIds(dir)
    assert.deepEqual(
      [...parsed].sort(),
      ["momentum", "principles", "questions", "tests"],
      "premise: the door's own parse reads all four lens units from the materialized bytes",
    )
    const derived = deriveLenses(dir)
    assert.deepEqual(
      [...derived].sort(),
      [...parsed].sort(),
      `INV-3/INV-4: "which lens units did this program materialize" is answered by TWO readers after this ` +
        `diff — the door's parse (smol-toml; it read ${JSON.stringify(parsed)} from these bytes and materialized ` +
        `them verbatim) and intake.sh's derivation (sed anchor /^[ \\t]*units = \\[/ — exactly one space on each ` +
        `side of '='). The template's units array is written \`units =[\` — legal TOML (whitespace around a ` +
        `key/value separator is optional), materialized byte-for-byte on the full-roster path — and the sed ` +
        `range never opens, so the derivation produced ${JSON.stringify(derived)}: ZERO order-<lens>.txt files ` +
        `while intake still prints "intake ok", and every lens silently reads diff.patch in the IDENTICAL order — ` +
        `the correlated first-attention the shuffle exists to kill (the principles-14 receipt class), with no ` +
        `refusal and no receipt. The derivation's own comment claims "the roster is the materialized units, ` +
        `never the hardcoded four … this reads the truth instead"; for the separator spellings TOML legalizes ` +
        `it reads nothing (the twin root refuses roster subsets on the same template with "no units block", ` +
        `review.ts stripUnitsToRoster's unitsLine anchor). Derive what the parse reads, or refuse the shape.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
