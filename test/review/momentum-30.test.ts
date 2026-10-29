import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"

// TRACE/MOMENTUM — "which lens units did this program materialize?" is
// answered by TWO sites: the door's PARSED read (smol-toml) and
// intake.sh's TEXTUAL lens derivation (templates/pr-review/hooks/
// intake.sh, the :lens-derivation marker block this diff wrote). The
// block's own comment promises tolerance: "TOML legalizes indented
// blocks, {id = "x"} unpadded braces, single quotes, and ANY key
// order". The single-quote arm covers quoted VALUES only — a
// single-quoted KEY, {'id' = 'tests'}, is legal TOML the door's parse
// reads and materializes verbatim, but the derivation's grep/awk match
// the literal bytes id[ \t]*= and derive nothing for that entry. The
// tests lens silently gets NO order-<lens>.txt — it reads diff.patch
// in the shared native order, the correlated first-attention the
// shuffle exists to kill — while intake still prints "intake ok": no
// refusal, no receipt. INV-3 (one decision, two disagreeing sites) and
// INV-4 (the change's own tolerance claim is false). Introduced by
// this diff (the marker block is new); on BASE the loop is the
// hardcoded four and the device below no-ops.

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const INTAKE = join(ROOT, "templates", "pr-review", "hooks", "intake.sh")
const intakeSrc = readFileSync(INTAKE, "utf8")

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

function parsedUnitIds(dir: string): string[] {
  const parsed = parseToml(readFileSync(join(dir, "workflow.toml"), "utf8")) as {
    stage?: Array<{ units?: Array<{ id?: string }> }>
  }
  return (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter((x): x is string => !!x)
}

test("intake's lens derivation reads every unit the door's parse reads — single-quoted KEY included", () => {
  if (!intakeSrc.includes("# :lens-derivation-start")) return // BASE: hardcoded reader — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-m30-"))
  try {
    // control: the shapes the block already tolerates still agree
    const ctl = join(tmp, "ctl")
    mkdirSync(ctl, { recursive: true })
    writeFileSync(
      join(ctl, "workflow.toml"),
      [
        "[workflow]",
        `name = "m30ctl"`,
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
    // gate-r17: the door's parse derives the handoff (lenses.txt) at
    // materialization; intake reads it. The harness stages the same
    // handoff the door writes for these bytes.
    mkdirSync(join(ctl, "data", "review"), { recursive: true })
    writeFileSync(join(ctl, "data", "review", "lenses.txt"), parsedUnitIds(ctl).join("\n") + "\n")
    assert.deepEqual(
      deriveLenses(ctl).sort(),
      parsedUnitIds(ctl).sort(),
      "control: the canonical inline shape derives what the parse reads",
    )

    // the law: a single-quoted KEY — legal TOML the door's parse reads.
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "m30"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  {temperature = 0.2, id = "principles", brief = "p"},`,
        `  {'id' = 'tests', brief = "t"},`,
        `  ]`,
        "",
      ].join("\n"),
    )
    const parsedTpl = parsedUnitIds(tpl)
    assert.deepEqual(
      parsedTpl,
      ["principles", "tests"],
      "premise: smol-toml — the door's own parser — reads BOTH unit ids from the quoted-key spelling",
    )
    // the handoff the door writes for these bytes (quoted key included —
    // the parse reads it, so the handoff carries it)
    mkdirSync(join(tpl, "data", "review"), { recursive: true })
    writeFileSync(join(tpl, "data", "review", "lenses.txt"), parsedTpl.join("\n") + "\n")

    // THE LAW (gate-r17's shape): intake derives FROM THE HANDOFF —
    // derived == the parse, whatever spelling carried the ids.
    const derived = deriveLenses(tpl)
    assert.deepEqual(
      [...derived].sort(),
      [...parsedTpl].sort(),
      `INV-3/INV-4: "which lens units did this program materialize?" is answered by the door's parse, ` +
        `handed off as data/review/lenses.txt, and read by intake — derived ${JSON.stringify(derived)} vs ` +
        `parsed ${JSON.stringify(parsedTpl)}. The quoted-key spelling {'id' = 'tests'} rides the parse ` +
        `into the handoff; no textual re-derivation exists to miss it.`,
    )

    // the refusal arm (the new design's own law): a program without the
    // handoff REFUSES — never silently derives nothing (a lens without
    // its order file reads diff.patch in the shared native order).
    rmSync(join(tpl, "data", "review", "lenses.txt"))
    let refused = ""
    try {
      deriveLenses(tpl)
    } catch (err) {
      refused = String((err as { stderr?: string }).stderr ?? err)
    }
    assert.match(
      refused,
      /lenses\.txt is missing or empty/,
      `INV-4 (refusal beats silence): with the handoff absent the block must refuse loudly — got ${JSON.stringify(refused.slice(0, 160))}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
