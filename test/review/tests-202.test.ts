import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the principles-26 device): on BASE intake.sh carries
// the hardcoded lens loop and no marker-delimited derivation — nothing
// to judge there.
const intakeSrc = readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8")
const doorOwnsTheReader = intakeSrc.includes(":lens-derivation-start")

// intake.sh's exact lens derivation, extracted verbatim from the shipped
// bytes (gate-r5: the test runs the reader the rail actually runs)
function deriveLenses(workflowTomlPath: string): string[] {
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

// the consumer's own read — the same parse the door's roster post-verify runs
function parsedUnitIds(workflowTomlPath: string): string[] {
  const parsed = parseToml(readFileSync(workflowTomlPath, "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
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

test("intake's lens derivation agrees with the door's parse for digit-bearing unit ids too", async () => {
  if (!doorOwnsTheReader) return // BASE: hardcoded reader — nothing to judge
  const { prepareReview } = await import("../../src/doors/review.ts")

  const tmp = mkdtempSync(join(tmpdir(), "whl-tests202-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    // digit-bearing lens ids — the same wave/generation naming this
    // diff's own momentum-18 fixture blesses ("api", "api-v2")
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "t202"`,
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
        `units = [`,
        `  { id = "lens1", temperature = 0.2, brief = "first" },`,
        `  { id = "lens2", temperature = 0.4, brief = "second" },`,
        `]`,
        "",
        "[[stage]]",
        `id = "merge"`,
        `topology = "gate"`,
        `run = "true"`,
        "",
      ].join("\n"),
    )

    // the door ACCEPTS and materializes this template (its reads are
    // parsed; the pin lands in the [workflow] header block)
    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door accepts and materializes the digit-id template: ${JSON.stringify(ready).slice(0, 200)}`,
    )
    const wf = join((ready as { dir: string }).dir, "workflow.toml")
    const parsed = parsedUnitIds(wf)
    assert.deepEqual(parsed.sort(), ["lens1", "lens2"], "premise: the door's own parse sees both lens units in the materialized bytes")

    // intake's textual reader must derive the same lenses
    const derived = deriveLenses(wf)
    assert.deepEqual(
      derived.sort(),
      parsed.sort(),
      `INV-3: "which lens units did this program materialize?" is answered TWICE after this diff — the ` +
        `door's parsed read (smol-toml stage[].units[].id) and intake.sh's textual derivation (grep ` +
        `'{ id = "[a-z]*"' + awk '/^id = "[a-z]*"/'). For a materialized template the door accepts whose ` +
        `lens ids carry a DIGIT ("lens1", "lens2" — the wave/generation naming the diff's own momentum-18 ` +
        `fixture blesses), the parsed read sees ${JSON.stringify(parsed)} while the textual reader derived ` +
        `${JSON.stringify(derived)}: zero order-<lens>.txt files, intake still prints "intake ok", and every ` +
        `lens silently reads the diff in the IDENTICAL order — the shuffle contract dead, the same ` +
        `silent-decorrelation-death class principles-26 pinned for [[stage.units]], one id-grammar later. ` +
        `One decision — the materialized roster — two readers that disagree on a door-accepted shape.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
