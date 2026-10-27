import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest } from "../../src/doors/hooks.ts"

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

function templateVariant(where: string, toml: string): string {
  mkdirSync(where, { recursive: true })
  cpSync(join(ROOT, "templates", "pr-review"), where, { recursive: true })
  writeFileSync(join(where, "workflow.toml"), toml)
  return where
}

// QUESTIONS.md #5 (break each new call: where does the error land) /
// INV-4 (the door's answer must be an answer): the diff's pin-plan ends
// in `parseToml(pinnedWorkflowToml)` — the verify whose comment claims
// "the verification is the consumer's own read" (src/doors/review.ts,
// the pin-plan block). A consumer read THROWS on bytes that do not
// parse, and nothing in prepareReview catches it: the TomlError escapes
// the door as an unhandled exception instead of the ReviewReady refusal
// (ok:false, code 2, the fix named) every other bad-input shape gets.
// The replace loop's own blind spots can MANUFACTURE unparseable pinned
// bytes from a template that was perfectly valid TOML on its own:
// an existing `model =` line written INDENTED (legal TOML — leading
// whitespace is allowed before any key/value pair) is invisible to the
// `/^model\s*=/` line-start matcher, so the insert branch adds a SECOND
// model key under [workflow] and the verify's parse dies on the
// duplicate the pin-write itself just created. BASE did not parse, so
// the door never crashed here — introduced by this change.
test("a template the pin cannot land in is refused with the fix named, never crashed on", () => {
  const shapes: [string, string][] = [
    [
      // valid TOML standalone; the pin insert duplicates the key and the
      // verify's own parse throws on bytes the door itself wrote
      "an indented existing model line inside [workflow] (valid TOML the replace loop cannot see)",
      [
        "[workflow]",
        `name = "t30"`,
        `worker_kind = "opencode"`,
        `  model = "old/lens-default"`,
        ``,
        "[[stage]]",
        `id = "u"`,
        `topology = "fan-out"`,
        `units = [{ id = "a", brief = "b" }]`,
        ``,
      ].join("\n"),
    ],
    [
      // plain malformed template toml — the verify parse throws on sight
      "a template whose workflow.toml is not valid TOML at all",
     [`[workflow`, `name = "t30"`, ``].join("\n"),
    ],
  ]
  for (const [label, toml] of shapes) {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t30-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const out = join(tmp, "program")
      const tpl = templateVariant(join(tmp, "tpl"), toml)
      let r: ReturnType<typeof prepareReview>
      try {
        r = prepareReview(
          { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
          join(ROOT, "templates"),
        )
      } catch (err) {
        assert.fail(
          `INV-4/QUESTIONS #5: the door must answer an unusable template with its own contract — ` +
            `a ReviewReady refusal (ok:false, code 2, why naming the template/pin fix) — not let the ` +
            `pin-verify's parseToml escape prepareReview as an uncaught exception. The diff's own comment ` +
            `claims "the verification is the consumer's own read"; a consumer read that throws must land as ` +
            `a refusal, the same way the missing-model and no-[workflow]-table shapes do. ` +
            `Shape: ${label}. Escaped: ${err instanceof Error ? err.constructor.name + ": " + err.message : String(err)}`,
        )
      }
      // no throw: then it must be a door refusal (or an honest acceptance
      // with the pin actually landed) — never a silent ok with no pin
      if (r.ok && !("skipped" in r && r.skipped)) {
        // BASE shape: the pre-diff door answered ok with bytes its own
        // consumer cannot parse (the four-late death — tests-23's class,
        // not this repro's). This repro proves only the DOOR crash.
        let manifest: { workflow?: { model?: string } }
        try {
          manifest = loadManifest(r.dir) as { workflow?: { model?: string } }
        } catch {
          return
        }
        assert.equal(
          manifest.workflow?.model,
          "acme/strong",
          `the door accepted ${label} — the pin must then land where the consumer reads it`,
        )
      } else if (!r.ok) {
        assert.equal((r as { code?: number }).code, 2, `the refusal for ${label} must be a code-2 door refusal`)
        assert.match((r as { why?: string }).why ?? "", /template|workflow|model/i, `the refusal for ${label} must name the fix`)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
