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

function templateDir(where: string, temperatureLine: string): string {
  mkdirSync(where, { recursive: true })
  for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
    writeFileSync(join(where, doc), "# seed\n")
  }
  writeFileSync(
    join(where, "workflow.toml"),
    [
      "[workflow]",
      `name = "t44"`,
      `worker_kind = "opencode"`,
      "",
      "[[stage]]",
      `id = "lenses"`,
      `topology = "fan-out"`,
      "",
      "[[stage.units]]",
      `id = "principles"`,
      temperatureLine,
      `brief = "p"`,
      "",
      "[[stage.units]]",
      `id = "tests"`,
      `brief = "t"`,
      "",
    ].join("\n"),
  )
  return where
}

// gate-r29 tests-44: 'is this a pin?' is ONE decision — the screen
// (pinsSpawnTemperature), the pin-plan (unresolvedTemperaturePins) and
// the host birth all answer by KEY PRESENCE whatever the value type,
// but the [[stage.<array>]] strip arm's line probe answered
// number-only — a string-valued `temperature = "0.4"` (legal TOML)
// survived the strip, failed the presence-based verify, and
// dead-ended the model-less dropout audit while the inline arm of the
// same strip deleted the identical pin. One decision, every arm, one
// answer.
for (const [label, line] of [
  ["a string-valued pin", `temperature = "0.4"`],
  ["a decimal pin", "temperature = 0.4"],
] as const) {
  test(`the audit strips ${label} from a [[stage.units]] block — presence is the question, not the value type`, () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t44-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = templateDir(join(tmp, "tpl"), line)
      const r = prepareReview(
        { repo, base: "master", head: "feat", out: join(tmp, "program"), template: tpl, auditLevy: true },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped) && "dir" in r && !!r.dir,
        `the model-less dropout audit must levy untuned (${label}) — the line probe answers the same presence question as the verify: ${JSON.stringify(r).slice(0, 220)}`,
      )
      const mat = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
        stage?: Array<{ units?: Array<Record<string, unknown>> }>
      }
      const entries = (mat.stage ?? []).flatMap((s) => s.units ?? [])
      for (const e of entries) {
        assert.ok(!("temperature" in e), `the ${label} was dropped (got temperature on ${JSON.stringify(e.id)})`)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
