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
// addition — on BASE intake.sh hardcodes the four lenses and writes an
// order file for every real lens whatever the template looks like, so
// there is no second reader to disagree and nothing to judge here.
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

// intake.sh's exact lens derivation, extracted verbatim from the
// marker-delimited block (the harness principles-26/questions-9/
// principles-37/momentum-24 adopted: "the test runs these exact bytes")
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

function templateDir(where: string, unitEntries: string[]): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "q12"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      `units = [`,
      ...unitEntries,
      `]`,
      "",
    ].join("\n"),
  )
  return where
}

test("intake's lens derivation reads an inline entry whose pre-id value carries a brace", () => {
  if (!intakeSrc.includes("# :lens-derivation-start")) return // BASE: hardcoded reader — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-q12-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))

    // ── control: temperature-first, brace-free — the shape principles-37
    // hardened. The derivation must read both units (proves the harness
    // and pins the fixed dimension stay green).
    const ctrlTpl = templateDir(join(tmp, "tpl-ctrl"), [
      `  { temperature = 0.2, brief = "call f and g", id = "principles" },`,
      `  { temperature = 0.4, id = "tests", brief = "t" },`,
    ])
    const ctrlReady = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog-ctrl"), template: ctrlTpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ctrlReady.ok && !("skipped" in ctrlReady && ctrlReady.skipped),
      `premise: the door materializes the brace-free template (got ${JSON.stringify(ctrlReady).slice(0, 200)})`,
    )
    const ctrlDir = (ctrlReady as { dir: string }).dir
    const ctrlParsed = parsedUnitIds(ctrlDir)
    assert.deepEqual([...ctrlParsed].sort(), ["principles", "tests"], "premise: the control's bytes parse to both lens units")
    const ctrlDerived = deriveLenses(ctrlDir)
    assert.deepEqual(
      [...ctrlDerived].sort(),
      [...ctrlParsed].sort(),
      "control: for a temperature-first BRACE-FREE entry the derivation reads what the door's parse reads (principles-37's fixed shape stays green)",
    )

    // ── the twin: the SAME shape plus ONE brace inside the pre-id value
    // (a code snippet in a brief — review-lens briefs quote TOML/shells
    // all the time). Legal TOML; the door's parse reads it and
    // materializes it verbatim on the full-roster path.
    const tpl = templateDir(join(tmp, "tpl"), [
      `  { temperature = 0.2, brief = "call f() {ok}", id = "principles" },`,
      `  { temperature = 0.4, id = "tests", brief = "t" },`,
    ])
    const tplIds = (() => {
      const parsed = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
    })()
    assert.deepEqual(
      [...tplIds].sort(),
      ["principles", "tests"],
      "premise: smol-toml — the door's own parser — reads both unit ids from the brace-bearing entry",
    )

    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door accepts and materializes the brace-bearing template (got ${JSON.stringify(ready).slice(0, 200)})`,
    )
    const dir = (ready as { dir: string }).dir
    const parsed = parsedUnitIds(dir)
    assert.deepEqual(
      [...parsed].sort(),
      ["principles", "tests"],
      "premise: the materialized bytes carry both lens units for the door's parse",
    )

    // THE LAW (the derivation's own comment): "the reader must read what
    // the door writes, or that lens silently loses its order file" — and
    // the same comment claims "ANY key order" tolerance.
    const derived = deriveLenses(dir)
    assert.deepEqual(
      [...derived].sort(),
      [...parsed].sort(),
      `INV-3 (one decision, two readers): "which lens units did this program materialize?" is answered by the ` +
        `door's parse (smol-toml stage[].units[].id — it read ${JSON.stringify(parsed)} from these bytes and ` +
        `materialized them verbatim) and by intake.sh's derivation (sed-grep arm: grep -oE '\\{[^}{]*id…' — the ` +
        `character class cannot cross a '{', so the id must be reachable brace-free from the entry's opening ` +
        `brace). The entry { temperature = 0.2, brief = "call f() {ok}", id = "principles" } — legal TOML, the ` +
        `same ANY-key-order form the derivation's own comment (intake.sh:96-99) claims tolerance for — carries a ` +
        `'{' inside its pre-id brief, so the arm matched NOTHING for it: the derivation derived ` +
        `${JSON.stringify(derived)} and the principles lens silently got NO order-<lens>.txt while its sibling ` +
        `did (intake still prints "intake ok", no refusal, no receipt). That lens reads diff.patch in the shared ` +
        `native order — the correlated first-attention the shuffle exists to kill (the principles-14 receipt ` +
        `class), one brace later than the shapes gate-r10/r14/r15 already hardened (principles-37 pinned ` +
        `key-order with brace-free values; the brace is the untested half of the same dimension). Derive what ` +
        `the parse reads, or refuse the shape — never a silent partial-shuffle review.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
