import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { parse as parseToml } from "smol-toml"

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

// INV-2 / INV-4 / the diff's own adopted law (test/review/tests-31:
// "the door never refuses a template whose [workflow] table the
// consumer reads — refuse only when the consumer truly cannot read
// the landing"). TOML permits WHITESPACE inside a table header:
// `[ workflow ]` declares the same [workflow] table `[workflow]`
// does, and smol-toml — the run-time's own parser, the read the
// pin-plan's verify claims to speak for — parses both identically.
// pinIntoWorkflowTable's tolerant header matcher
// (/^\[workflow\]\s*(#.*)?$/ on the trimmed line) accepts a trailing
// comment (the tests-31 shape 1 receipt) but NOT interior spaces:
// headerIdx is -1, the dotted arm finds no workflow.* keys, the
// landing is undefined, and prepareReview refuses with
// "the template's workflow.toml has no [workflow] table" — a FALSE
// premise, the same class tests-31 pinned one shape later. The diff
// touched this exact anchor (the tolerant matcher carries the
// tests-31 receipt) and left this form wrong: the incomplete-fix
// class. On BASE there was no pin-verify refusal at all, so the
// false-premise refusal is introduced by this change.
test("the door never refuses a template whose spaced [ workflow ] header the consumer reads", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t41-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
    // the ONLY mutation: spaces inside the workflow table header —
    // legal TOML, identical parsed shape
    const original = readFileSync(join(tpl, "workflow.toml"), "utf8")
    const spaced = original.replace(/^\[workflow\][ \t]*$/m, "[ workflow ]")
    assert.notEqual(spaced, original, "premise: the template's [workflow] header was rewritten to the spaced form")
    writeFileSync(join(tpl, "workflow.toml"), spaced)

    // the consumer's own read: smol-toml parses a [workflow] table
    // from the spaced header — the refusal's premise is checkable
    const consumerSeesWorkflow = (parseToml(spaced) as { workflow?: unknown }).workflow
    assert.ok(
      consumerSeesWorkflow !== undefined,
      "premise: smol-toml — the run-time's own parser — reads a [workflow] table from the spaced header",
    )

    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    const falsePremise = !r.ok && /no \[workflow\] table/.test(String((r as { why?: string }).why ?? ""))
    assert.ok(
      !falsePremise,
      `INV-2/INV-4 / tests-31's adopted law ("the door never refuses a template whose [workflow] table the ` +
        `consumer reads"): the template declares its [workflow] table as \`[ workflow ]\` — legal TOML; smol-toml ` +
        `parses workflow = ${JSON.stringify(consumerSeesWorkflow)} — yet the pin-plan's landing ` +
        `(pinIntoWorkflowTable, src/doors/review.ts: the tolerant header matcher ` +
        `/^\\[workflow\\]\\s*(#.*)?$/.test(l.trim()) accepts a trailing comment but not interior spaces) found no ` +
        `header, the dotted arm found no workflow.* keys, and prepareReview refused with "the template's ` +
        `workflow.toml has no [workflow] table" (ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}) — ` +
        `a false premise. tests-31 pinned this class for a trailing comment and a [[stage]] span overshoot; the ` +
        `spaced header is the same law one shape later, on the anchor this diff itself touched. On BASE no ` +
        `pin-verify existed and the template materialized (the pin silently vanished — the INV-2 hole this diff ` +
        `closes); the false-premise REFUSAL is introduced by this change.`,
    )
    // any acceptance must still land the pin where the consumer reads it
    if (r.ok && !("skipped" in r && r.skipped)) {
      const pinned = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.match(
        pinned,
        /model = "acme\/strong"/,
        "if the door accepts the spaced-header template, the pin must land in the workflow table the consumer reads",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
