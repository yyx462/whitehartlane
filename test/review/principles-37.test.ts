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

// BASE shape: the marker-delimited derivation is this diff's own
// addition — on BASE intake.sh hardcodes the four lenses, so there is
// no second reader and nothing to judge.
const intakeSrc = readFileSync(INTAKE, "utf8")

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

// intake.sh's exact lens derivation (the marker-delimited block), run
// verbatim — the harness principles-26/momentum-22/principles-31 adopted
// ("the test runs these exact bytes")
function deriveLenses(programDir: string): string[] {
  const block = intakeSrc.split("# :lens-derivation-start")[1]?.split("# :lens-derivation-end")[0]
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

test("intake's lens derivation reads a temperature-first units entry the door's parse reads", () => {
  if (!intakeSrc.includes("# :lens-derivation-start")) return // BASE: hardcoded reader — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-p37-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    // ONE temperature-first entry among id-first ones — legal TOML the
    // door's parse reads, materializes verbatim, and (on the audit path)
    // stripTemperaturePins itself names as a form it must serve ("ANY
    // key order … the door's parse reads and materializes them")
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "p37"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { temperature = 0.2, id = "principles", brief = "p" },`,
        `  { id = "tests", temperature = 0.4, brief = "t" },`,
        `]`,
        "",
      ].join("\n"),
    )

    // premise: the door's own parse reads BOTH ids from these bytes
    const tplIds = parsedUnitIds(tpl)
    assert.deepEqual(
      [...tplIds].sort(),
      ["principles", "tests"],
      "premise: smol-toml — the door's own parser — reads both unit ids, temperature-first included",
    )

    // the door MATERIALIZES this template (text-preserving: the pin lands
    // under [workflow]; the units bytes survive verbatim)
    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door materializes the temperature-first template (got ${JSON.stringify(ready).slice(0, 240)})`,
    )
    const dir = (ready as { dir: string }).dir
    const parsed = parsedUnitIds(dir)
    assert.deepEqual(
      [...parsed].sort(),
      ["principles", "tests"],
      "premise: the materialized bytes carry both lens units for the door's parse",
    )

    // THE LAW (the derivation's own comment): "the textual reader must
    // derive the same lenses or every lens silently loses its shuffled
    // hunk order" — the derived roster must equal the door's parse.
    const derived = deriveLenses(dir)
    assert.deepEqual(
      [...derived].sort(),
      [...parsed].sort(),
      `INV-3 (one decision, two readers): "which lens units did this program materialize?" is answered by the ` +
        `door's parse (smol-toml stage[].units[].id — it read ${JSON.stringify(parsed)} and materialized them ` +
        `verbatim) and by intake.sh's derivation, whose sed+grep arm matches only \\{[ \\t]*id[ \\t]*= — the id ` +
        `must ride FIRST in the inline entry. The temperature-first entry ({ temperature = 0.2, id = "principles", … }) ` +
        `— legal TOML this door's own stripTemperaturePins comment blesses as a materialized form ("ANY key order … ` +
        `the door's parse reads and materializes them") — matched NOTHING: the derivation derived ` +
        `${JSON.stringify(derived)} and the principles lens silently got NO order-<lens>.txt while its sibling did ` +
        `(intake still prints "intake ok", no refusal, no receipt). That lens reads diff.patch in the shared native ` +
        `order — the correlated first-attention the shuffle exists to kill (the principles-14 receipt class), one ` +
        `key order later than the shapes gate-r10/r11 already hardened. Derive what the parse reads, or refuse the ` +
        `shape — never a silent partial-shuffle review.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
