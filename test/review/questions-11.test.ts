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

// questions-1 — INV-3 (one decision, one place) / INV-4 (the reader's
// own claim is false). "Which lens units did this program materialize?"
// is answered by TWO sites: the door's PARSED read (smol-toml — the
// pin-verify, the temp-pin walk and the roster post-verify all consume
// it) and intake.sh's TEXTUAL lens derivation (the marker block). The
// r24/r25 hardening (principles-26: [[stage.units]]; principles-37:
// temperature-first) rewrote the block to follow the parse, and its
// own comment now claims spelling tolerance: "TOML legalizes indented
// blocks, {id = "x"} unpadded braces, single quotes, and ANY key
// order". The single-quote arm covers quoted VALUES only — a
// single-quoted KEY, {'id' = 'tests'}, is legal TOML the door's own
// parser reads (the door ACCEPTS the template and materializes both
// units verbatim), but the derivation's grep/awk match the literal
// bytes id[ \t]*= and derive nothing for that entry. The "tests" lens
// silently gets no order-<lens>.txt — it reads diff.patch in the
// shared native order, the correlated first-attention the shuffle
// exists to kill (the principles-14 receipt class) — while intake
// still prints "intake ok": no refusal, no receipt. One shape later
// than the two shapes this same block was already fixed for: the
// incomplete-fix class. On BASE the hardcoded four-lens loop wrote an
// order file for every real lens whatever the template says — the
// silent loss is introduced by this change.
const intakeSrc = readFileSync(INTAKE, "utf8")

// intake.sh's exact derivation bytes (the marker block), run verbatim
// — the harness principles-26 adopted ("the test runs these exact
// bytes"): the reader and its pin can never drift apart silently.
function deriveLenses(dir: string): string[] {
  const block = intakeSrc.split("# :lens-derivation-start")[1]?.split("# :lens-derivation-end")[0]
  assert.ok(block, "sanity: intake.sh carries the marker-delimited lens derivation")
  const out = execFileSync(
    "bash",
    ["-c", `prog=${JSON.stringify(dir)}\n${block}\nprintf '%s\\n' $lenses`],
    { encoding: "utf8" },
  )
  return out.trim().split("\n").filter(Boolean)
}

// the door's own parsed read of the same bytes
function parsedUnitIds(dir: string): string[] {
  const parsed = parseToml(readFileSync(join(dir, "workflow.toml"), "utf8")) as {
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

test("intake's lens derivation reads every unit the door's parse reads — quoted-key spelling included", () => {
  if (!intakeSrc.includes("# :lens-derivation-start")) return // BASE: hardcoded reader — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-q11-"))
  try {
    // ── control: the two shapes the block was already fixed for still
    // agree with the parse (canonical inline, [[stage.units]])
    const ctl = join(tmp, "ctl")
    mkdirSync(ctl, { recursive: true })
    writeFileSync(
      join(ctl, "workflow.toml"),
      [
        "[workflow]",
        `name = "q11ctl"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", temperature = 0.2, brief = "p" },`,
        `  { id = "tests", temperature = 0.4, brief = "t" },`,
        `]`,
        "",
      ].join("\n") + "\n",
    )
    assert.deepEqual(
      deriveLenses(ctl).sort(),
      parsedUnitIds(ctl).sort(),
      "control: the canonical inline shape still derives what the parse reads",
    )

    // ── the law, end to end: a template whose second unit spells its
    // KEY with single quotes — legal TOML. The door must not serve a
    // template whose intake reader sees less than the parse does.
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "q11"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `  units=[`,
        `  {temperature = 0.2, id = "principles", brief = "p"},`,
        `  {'id' = 'tests', brief = "t"},`,
        `  ]`,
        "",
      ].join("\n") + "\n",
    )
    const parsedTpl = parsedUnitIds(tpl)
    assert.deepEqual(
      parsedTpl,
      ["principles", "tests"],
      "premise: smol-toml — the door's own parser — reads BOTH unit ids from the quoted-key spelling",
    )

    const ready = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ready.ok && !("skipped" in ready && ready.skipped),
      `premise: the door ACCEPTS the quoted-key template and materializes both units (got ${JSON.stringify(ready).slice(0, 240)}) — a refusal here would make this an honest refuse, not a silent loss`,
    )
    const dir = (ready as { dir: string }).dir
    const parsed = parsedUnitIds(dir)
    assert.deepEqual(
      parsed,
      ["principles", "tests"],
      "premise: the materialized bytes carry both lens units for the door's parse (the roster post-verify's read)",
    )

    // THE LAW: the derivation must equal the parse on the bytes the
    // door materialized — "the textual reader must derive the same
    // lenses or every lens silently loses its shuffled hunk order".
    const derived = deriveLenses(dir)
    assert.deepEqual(
      [...derived].sort(),
      [...parsed].sort(),
      `INV-3/INV-4: "which lens units did this program materialize?" is decided by TWO sites that DISAGREE on ` +
        `these very bytes. The door's parse read ${JSON.stringify(parsed)} and materialized them verbatim; ` +
        `intake.sh's marker-block derivation — whose own comment promises "spelling- … tolerant … single quotes" — ` +
        `derived ${JSON.stringify(derived)}: its grep/awk arms match the literal bytes id[ \\t]*= and a ` +
        `single-quoted KEY ({'id' = 'tests'}, legal TOML smol-toml parses) matches nothing. The tests lens ` +
        `silently got NO order-<lens>.txt while its sibling did, intake still prints "intake ok" — no refusal, ` +
        `no receipt — and that lens reads diff.patch in the shared native order: the correlated first-attention ` +
        `the shuffle exists to kill, one key spelling later than the shapes gate-r5/r14 already fixed ` +
        `(principles-26/37). The reader must read what the parse reads (derive from the parse, or match quoted ` +
        `keys), or the door must refuse the shape — never a silent partial-shuffle review.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
