import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard: on BASE intake.sh hardcodes the four lenses (every
// real lens got an order file whatever the template says), so the twin
// this repro judges — the textual roster reader — does not exist there.
const intake = readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8")
const doorOwnsTheReader = intake.includes("this reads the truth instead")

// intake.sh's exact lens derivation (intake.sh:92-95), verbatim
function deriveLenses(workflowTomlPath: string): string[] {
  // THE PRODUCTION READER'S OWN BYTES (gate-r5: a frozen copy of the
  // old pipeline could never see the fix — the test extracts the
  // marker-delimited derivation from intake.sh and runs it verbatim,
  // so the door's parse and the reader it ships can never drift
  // apart without this test going red)
  const intake = readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8")
  const block = intake.split("# :lens-derivation-start")[1]?.split("# :lens-derivation-end")[0]
  assert.ok(block, "sanity: intake.sh carries the marker-delimited lens derivation")
  const prog = dirname(workflowTomlPath)
  const out = execFileSync(
    "bash",
    ["-c", `prog=${JSON.stringify(prog)}\n${block}\nprintf '%s\\n' $lenses`],
    { encoding: "utf8" },
  )
  return out.trim().split("\n").filter(Boolean)
}

// the consumer's own read of the same bytes — the parse the door itself
// runs (the roster post-verify at review.ts:429-431 reads exactly this)
function parsedUnitIds(workflowTomlPath: string): string[] {
  const parsed = parseToml(readFileSync(workflowTomlPath, "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

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
  return where
}

// INV-3 (one decision, one place): "which lens units did this program
// materialize?" is answered by TWO readers of the SAME file after this
// diff —
//   src/doors/review.ts        the PARSED read (smol-toml: stage[].units[].id —
//                              the roster post-verify, review.ts:429-431)
//   templates/pr-review/hooks/intake.sh:93 the TEXTUAL read
//                              (sed -n '/^units = \[/,/^\]/p' | grep -o '{ id = "[a-z]*"')
// The diff's own comment states the intent: "the roster is the
// materialized units, never the hardcoded four … this reads the truth
// instead". But the textual anchor is narrower than TOML: for a
// [[stage.units]] array-of-tables declaration — legal TOML the run-time's
// own parser reads perfectly, and which the door therefore ACCEPTS and
// materializes (the pin-verify, the temp-pin walk, and the roster
// post-verify all pass on the parsed shape) — the sed anchor matches
// NOTHING, the loop iterates over zero lenses, and ZERO
// data/review/order-<lens>.txt files are written. Nothing downstream
// checks: intake still prints "intake ok", and every lens silently loses
// its shuffled hunk order (the decorrelation the order file exists for)
// — the same silent-decorrelation-death this diff's own receipt pins for
// the stringify landing (gate-r1 momentum-1/principles-14: "every
// model-pinned review derived ZERO lens order files"), one template
// shape later. On BASE the hardcoded loop wrote an order file for every
// real lens whatever the template's TOML shape — the disagreement is
// introduced by this change.
test("intake's lens derivation agrees with the door's own parse for every template shape the door accepts", () => {
  if (!doorOwnsTheReader) return // BASE: hardcoded reader — nothing to judge

  // ── control: the SHIPPED template — the two readers agree (this pins
  // the harness, and the normal path the diff fixed must stay green)
  const ctl = mkdtempSync(join(tmpdir(), "whl-p26-ctl-"))
  try {
    const repo = fixtureRepo(join(ctl, "repo"))
    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(ctl, "prog") },
      join(ROOT, "templates"),
    )
    assert.ok(ready.ok && !("skipped" in ready && ready.skipped), `sanity: the shipped template materializes: ${JSON.stringify(ready).slice(0, 200)}`)
    const wf = join((ready as { dir: string }).dir, "workflow.toml")
    assert.deepEqual(
      deriveLenses(wf).sort(),
      parsedUnitIds(wf).sort(),
      "sanity/control: for the shipped template's units = [ … ] shape, intake's textual reader and the door's parsed read agree",
    )
  } finally {
    rmSync(ctl, { recursive: true, force: true })
  }

  // ── the twin: [[stage.units]] array-of-tables — the door accepts it,
  // intake's textual reader sees nothing
  const tmp = mkdtempSync(join(tmpdir(), "whl-p26-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = templateDir(join(tmp, "tpl"))
    // the ONLY mutation: the units array declared as [[stage.units]]
    // sub-tables — legal TOML, the identical parsed shape the door's
    // own reads consume
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "p26"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        "[[stage.units]]",
        `id = "principles"`,
        "temperature = 0.2",
        `brief = "b"`,
        "[[stage.units]]",
        `id = "tests"`,
        "temperature = 0.4",
        `brief = "b"`,
        "",
      ].join("\n"),
    )

    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door ACCEPTS the [[stage.units]] form (its reads are parsed, not textual): ${JSON.stringify(ready).slice(0, 200)}`,
    )
    const wf = join((ready as { dir: string }).dir, "workflow.toml")
    const parsed = parsedUnitIds(wf)
    assert.deepEqual(parsed.sort(), ["principles", "tests"], "premise: the door's own parse sees both lens units in the materialized bytes")
    const derived = deriveLenses(wf)
    assert.deepEqual(
      derived.sort(),
      parsed.sort(),
      `INV-3: "which lens units did this program materialize" is answered TWICE after this diff — the door's ` +
        `parsed read (review.ts:429-431, smol-toml stage[].units[].id) and intake.sh:93's textual anchor ` +
        `(\`sed -n '/^units = \\[/,/^\\]/p' | grep -o '{ id = "[a-z]*"'\`, "this reads the truth instead"). For a ` +
        `template the door accepts and materialized — its units declared as [[stage.units]] array-of-tables, legal ` +
        `TOML the run-time's own parser reads — the parsed read sees [principles, tests] while the textual reader ` +
        `derived ${JSON.stringify(derived)}: zero order-<lens>.txt files, intake still prints "intake ok", and every ` +
        `lens silently reads the diff in the IDENTICAL order — the shuffle contract dead, the same silent class this ` +
        `diff's own receipt pins for the stringify landing (gate-r1 momentum-1/principles-14) and the same ` +
        `reader-narrower-than-TOML class its adopted tests-31/questions-4-r22/tests-41 law forbids ("refuse only ` +
        `when the consumer truly cannot read"). One decision — the materialized roster — two readers that disagree ` +
        `on a door-accepted shape; the anchor must read what the door's own parse reads (or the door must refuse ` +
        `shapes its intake reader cannot derive).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
