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
// addition — on BASE intake.sh hardcodes the four canonical lenses and
// there is no derivation block, so nothing is judged there (the
// momentum-14 device: guarded on the marker, vacuous green on BASE).
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
// marker-delimited block (the principles-26/questions-9 harness: the
// test runs the bytes the rail runs)
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

// INV-3 (one decision, one place — "which lens units did this program
// materialize?") — the twin class gate-r5/r10/r12/r14/r15/r16 each
// fixed one spelling of, persisting in a spelling none of them pinned:
// TOML multi-line strings and basic-string escapes. `id = """sec"""`
// (multi-line basic string) and `id = "\u0073ec"` (unicode escape) are
// legal TOML values smol-toml — the door's own parser — decodes to the
// SHEP_ID_CLASS-legal id "sec"; the door materializes the template
// verbatim and the run path (hooks.ts SHEP_SAFE_ID on the PARSED id)
// executes it. The derivation's two textual arms match only
// quote-then-[a-z], so both spellings derive NOTHING for that unit:
// the loop writes no order-sec.txt, intake still prints "intake ok",
// and that lens reads diff.patch in the shared native order — the
// correlated first-attention the shuffle exists to kill, with no
// refusal and no receipt. The door neither derives the shape nor
// refuses it — the exact law its own repros state ("derive what the
// parse reads, or refuse the shape").
test("intake's derivation reads every unit id the door's parse decodes — multi-line strings and escapes included", () => {
  if (!intakeSrc.includes("# :lens-derivation-start")) return // BASE: hardcoded reader — nothing to judge

  for (const [label, idLine] of [
    ["the multi-line basic string (id = \"\"\"sec\"\"\")", `id = """sec"""`],
    [`the basic-string unicode escape (id = "\\u0073ec")`, `id = "\\u0073ec"`],
  ] as [string, string][]) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-q13-"))
    try {
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
          `name = "q13"`,
          `worker_kind = "opencode"`,
          "",
          "[[stage]]",
          `id = "lenses"`,
          `topology = "fan-out"`,
          "",
          "[[stage.units]]",
          idLine,
          `brief = "b"`,
          "",
          "[[stage.units]]",
          `id = "tests"`,
          `brief = "t"`,
          "",
        ].join("\n"),
      )

      // premise: smol-toml — the door's own parser — decodes the id to
      // the same string SHEP_SAFE_ID legalizes ("sec")
      const premised = parseToml(readFileSync(join(tpl, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<{ id?: string }> }>
      }
      const tplIds = (premised.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean)
      assert.deepEqual(
        [...tplIds].sort(),
        ["sec", "tests"],
        `premise (${label}): smol-toml decodes the id to the SHEP-legal string ("sec")`,
      )

      // the door ACCEPTS and materializes it without a word
      const ready = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out: join(tmp, "prog"), template: tpl },
        join(ROOT, "templates"),
      )
      assert.ok(
        ready.ok && !("skipped" in ready && ready.skipped),
        `premise (${label}): the door materializes the template (got ${JSON.stringify(ready).slice(0, 200)})`,
      )
      const dir = (ready as { dir: string }).dir
      const parsed = parsedUnitIds(dir)
      assert.deepEqual(
        [...parsed].sort(),
        ["sec", "tests"],
        `premise (${label}): the materialized bytes carry both unit ids for the door's parse`,
      )

      // THE LAW: the derivation must equal the parse on the bytes the
      // door materialized
      const derived = deriveLenses(dir)
      assert.deepEqual(
        [...derived].sort(),
        [...parsed].sort(),
        `INV-3 (${label}): "which lens units did this program materialize" is answered by TWO readers after ` +
          `this diff — the door's parse (smol-toml: it decoded and materialized ${JSON.stringify(parsed)}; the ` +
          `run path executes "sec" — hooks.ts SHEP_SAFE_ID validates the PARSED id) and intake.sh's textual ` +
          `arms (sed-grep + awk, quote-then-[a-z] only). For the ${label} spelling — legal TOML — the arms ` +
          `matched nothing: the derivation derived ${JSON.stringify(derived)}, the sec lens gets NO ` +
          `order-<lens>.txt while its sibling does, and intake still prints "intake ok" — no refusal, no ` +
          `receipt. That lens reads diff.patch in the shared native order: the correlated first-attention the ` +
          `shuffle exists to kill (the principles-14 receipt class), one string spelling later than the shapes ` +
          `gate-r5/r10/r12/r14/r15/r16 already hardened (principles-26/31, questions-9/11/12, momentum-22/30, ` +
          `tests-202). Derive what the parse reads (the door already knows the roster it materialized — write ` +
          `it, or parse in the derivation), or refuse the shape — never a silent partial-shuffle review.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
