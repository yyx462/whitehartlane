import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

// gate-r2 momentum-15's model-less dropout audit strips temperature PINS
// (the pins are "tuning, not law"). stripTemperaturePins (src/doors/review.ts)
// rewrites any line matching /\{[^}]*\btemperature\s*=\s*[0-9]+/ — and a
// BRIEF STRING VALUE that mentions the word satisfies that matcher even
// when the unit carries a real pin elsewhere. The second replace
// (/temperature\s*=\s*[0-9]+(\.[0-9]+)?\s*,\s*/g) then eats the match from
// INSIDE the string value: the materialized brief is not the template's
// brief. The parse-verify behind the strip only asks "no temperature KEY
// survives" — a mangled VALUE passes it, the materialization ships ok:true,
// and the lens is briefed with a different question than the program
// author wrote. Verified on HEAD: brief "hold temperature = 5, then cool"
// materializes as "hold then cool".
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

test("the audit's temperature strip removes pins, never the briefs' own words", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests2005-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tplRoot = join(tmp, "tpl")
    const tpl = join(tplRoot, "pr-review")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    const BRIEF = "hold temperature = 5, then cool"
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "t2005"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "${BRIEF}", temperature = 0.2 },`,
        `]`,
        "",
      ].join("\n"),
    )

    const r = prepareReview(
      // the model-less dropout audit: gate audit + no --model — the one
      // path that strips pins instead of pinning a model
      { repo, base: "master", head: "feat", model: undefined, auditLevy: true, out: join(tmp, "prog") },
      tplRoot,
    )
    if (!r.ok || ("skipped" in r && r.skipped)) {
      // a tree without the audit-levy seam (BASE) refuses the model-less
      // levy at the door — the strip and its fault do not exist there;
      // nothing to judge on this tree
      return
    }
    const toml = readFileSync(join(r.dir, "workflow.toml"), "utf8")
    assert.ok(
      toml.includes(BRIEF),
      `the strip must remove the temperature PIN, never rewrite a brief VALUE. ` +
        `The template brief ${JSON.stringify(BRIEF)} materialized as ` +
        `${JSON.stringify(toml.split("\n").find((l) => l.includes("brief"))?.trim() ?? "(gone)")} — ` +
        `stripTemperaturePins' inline matcher /\{[^}]*\\btemperature\\s*=/ matches the word inside the ` +
        `string, and its comma-form replace deletes "temperature = 5, " from inside the value. ` +
        `The strip's parse-verify only checks that no temperature KEY survives, so the mangled brief ` +
        `ships ok:true and the lens is briefed with a different question than the program declared.`,
    )
    // the pin check walks the PARSE (adapted, gate-r17: the textual
    // !includes("temperature =") would outlaw the verbatim brief above —
    // the brief's own words contain "temperature = 5"; a KEY is the
    // strip's business, and only the parse knows a key from a word in
    // a string)
    const parsedMat = parseToml(toml) as unknown
    let pinKeySurvives = false
    ;(function walk(node: unknown): void {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "temperature") pinKeySurvives = true
          else walk(v)
        }
      }
    })(parsedMat)
    assert.ok(
      !pinKeySurvives,
      "the pin itself must still be gone (the strip's actual job) — a temperature KEY survives the parse",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
