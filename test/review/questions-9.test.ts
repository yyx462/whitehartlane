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

// BASE shape: the marker-delimited derivation (intake.sh) and the roster
// strip (review.ts stripUnitsToRoster) are this diff's own additions — on
// BASE intake.sh hardcodes the four lenses and the door has no strip, so
// neither reader exists and nothing is judged there (the momentum-14
// device: vacuous green on BASE, so the prove gate classifies this repro
// as introduced).
const doorOwnsTheReaders =
  readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster") &&
  readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8").includes(
    ":lens-derivation-start",
  )

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

// The template's own multi-line units array, INDENTED one level — legal
// TOML (whitespace may precede any key/value line), the identical parsed
// shape the door's own reads consume. Everything else is the shipped
// template's shape: [workflow] header, temperature-pinned lens units.
function indentedUnitsTemplate(where: string): string {
  mkdirSync(where, { recursive: true })
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "q9"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `  units = [`,
      `    { id = "principles", temperature = 0.2, brief = "p" },`,
      `    { id = "tests", temperature = 0.4, brief = "t" },`,
      `    { id = "momentum", temperature = 0.6, brief = "m" },`,
      `    { id = "questions", temperature = 0.8, brief = "q" },`,
      `  ]`,
      "",
      "[[stage]]",
      `id = "merge"`,
      `topology = "gate"`,
      `run = "true"`,
      "",
    ].join("\n"),
  )
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  return where
}

// intake.sh's exact lens derivation, extracted verbatim from the shipped
// bytes (the principles-26 harness: the test runs the reader the rail runs)
function deriveLenses(workflowTomlPath: string): string[] {
  const intake = readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8")
  const block = intake.split("# :lens-derivation-start")[1]?.split("# :lens-derivation-end")[0]
  assert.ok(block, "sanity: intake.sh carries the marker-delimited lens derivation")
  const prog = join(workflowTomlPath, "..")
  const out = execFileSync(
    "bash",
    ["-c", `prog=${JSON.stringify(prog)}\n${block}\nprintf '%s\\n' $lenses`],
    { encoding: "utf8" },
  )
  return out.trim().split("\n").filter(Boolean)
}

// the door's own read — the parse the door itself runs
function parsedUnitIds(workflowTomlPath: string): string[] {
  const parsed = parseToml(readFileSync(workflowTomlPath, "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

test("intake's lens derivation reads the indented units array the door's own parse reads", () => {
  if (!doorOwnsTheReaders) return // BASE: hardcoded reader, no strip — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-q9-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = indentedUnitsTemplate(join(tmp, "tpl"))

    // premise: smol-toml — the door's own parser — reads all four lens
    // units from the indented form
    const premised = parsedUnitIds(join(tpl, "workflow.toml"))
    assert.deepEqual(
      [...premised].sort(),
      ["momentum", "principles", "questions", "tests"],
      "premise: the indented multi-line units array is legal TOML the door's own parser reads",
    )

    // the door ACCEPTS and materializes it (its reads are parsed)
    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door materializes the indented-units template it parses fine: ${JSON.stringify(ready).slice(0, 200)}`,
    )
    const wf = join((ready as { dir: string }).dir, "workflow.toml")
    const parsed = parsedUnitIds(wf)
    assert.deepEqual(
      [...parsed].sort(),
      ["momentum", "principles", "questions", "tests"],
      "premise: the materialized bytes carry all four lens units for the door's parse",
    )

    // THE LAW: the shipped reader must derive what the door's parse reads
    const derived = deriveLenses(wf)
    assert.deepEqual(
      [...derived].sort(),
      [...parsed].sort(),
      `INV-3 (one decision, one place — "which lens units did this program materialize?") / INV-4 (the ` +
        `derivation's own comment claims "the roster is the materialized units … this reads the truth instead", ` +
        `intake.sh:89-91): the decision is answered TWICE after this diff — the door's PARSED read ` +
        `(review.ts:405/423, smol-toml stage[].units[].id, which read all four units) and intake.sh's TEXTUAL ` +
        `anchors (intake.sh:96 sed '/^units = \\[/,/^\\]/p' + grep, intake.sh:104 awk '^\\[\\[stage\\.units\\]\\]') ` +
        `— both anchored at column 0. For the door-accepted template whose units array is indented one level ` +
        `(legal TOML; the premise above proves the parse reads ${JSON.stringify(parsed)}), the textual reader ` +
        `derived ${JSON.stringify(derived)}: ZERO order-<lens>.txt files, intake still prints "intake ok", and ` +
        `every lens silently reads diff.patch in the IDENTICAL order — the correlated first-attention the ` +
        `shuffle exists to kill (the principles-14 receipt class), one indentation later than the ` +
        `[[stage.units]]/digit-id shapes its own repros (principles-26, momentum-22, tests-202) already pinned ` +
        `and fixed. The strip twin (review.ts:186/210 startsWith("units = [")) carries the same column-0 anchor. ` +
        `One decision, three readers; the anchors must read what the door's parse reads (or the door must refuse ` +
        `shapes its own intake cannot derive).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the roster strip never refuses a template whose units block the door's own parse reads", () => {
  if (!doorOwnsTheReaders) return // BASE: no strip — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-q9b-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = indentedUnitsTemplate(join(tmp, "tpl"))
    const premise = parsedUnitIds(join(tpl, "workflow.toml"))
    assert.ok(premise.length === 4, "premise: the door's parse reads the indented units block")

    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles", "tests"], out, template: tpl },
      join(ROOT, "templates"),
    )
    const falsePremise =
      !r.ok && /no units block for roster subsetting/.test(String((r as { why?: string }).why ?? ""))
    assert.ok(
      !falsePremise,
      `INV-3/INV-4 (a refusal's premise must survive the door's own consumer read): the roster strip ` +
        `(review.ts:186 — lines.some((l) => l.startsWith("units = [")), seated BEFORE the parse at review.ts:405, ` +
        `refused with "template has no units block for roster subsetting" (ok=${String(r.ok)}, code=${String((r as { code?: number }).code)}, ` +
        `why=${JSON.stringify((r as { why?: string }).why ?? "")}) — but the template HAS a units block: the door's ` +
        `own parse (the identical read the roster post-verify at review.ts:421-439 runs) reads ${JSON.stringify(premise)} ` +
        `from these bytes. The same function answers "is there a units block?" two opposite ways — the column-0 ` +
        `textual anchor says no, the parse says yes — so a gate roster cannot be served on a template shape the ` +
        `door's own law (tests-31, adopted: "refuse only when the consumer truly cannot read the landing") forbids ` +
        `refusing. The false-premise refusal is introduced by this change (BASE had no strip).`,
    )
    // any acceptance must materialize the subset the gate decided
    if (r.ok && !("skipped" in r && r.skipped)) {
      const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.match(toml, /id = "principles"/, "the kept lens survives the strip")
      assert.match(toml, /id = "tests"/, "the kept lens survives the strip")
      assert.doesNotMatch(toml, /id = "momentum"/, "the gate's roster decision is served: momentum is stripped")
      assert.doesNotMatch(toml, /id = "questions"/, "the gate's roster decision is served: questions is stripped")
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
