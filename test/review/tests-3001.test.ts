import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape: the pin-verify does not exist there — nothing to judge.
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("pinIntoWorkflowTable")) {
  test("tests-3001: BASE — no pin landing verify, nothing to judge", () => {})
} else {
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

  // INV-2/INV-4 / the door's own adopted law (tests-31, tests-41: "the
  // door never refuses a template whose [workflow] table the consumer
  // reads — refuse only when the consumer truly cannot read the
  // landing"). TOML declares a table's key as a QUOTED string too:
  // `["workflow"]` is the same [workflow] table `[workflow]` is, and
  // smol-toml — the run-time's own parser, the read the pin-verify
  // claims to speak for — parses both identically (premise below).
  // pinIntoWorkflowTable's three arms (tolerant header matcher, dotted
  // workflow.* keys, single-line inline table) all miss the quoted-key
  // header: headerIdx is -1, no dotted keys, no inline table, and
  // prepareReview refuses with "the template's workflow.toml has no
  // [workflow] table" — a FALSE premise, the same class tests-31
  // pinned for a trailing comment and tests-41 for interior spaces,
  // one token later on the anchor this diff itself hardened.
  test("the door never refuses a template whose [\"workflow\"] quoted-key header the consumer reads", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-t3001-"))
    try {
      const repo = fixtureRepo(join(tmp, "repo"))
      const tpl = join(tmp, "tpl")
      cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
      // the ONLY mutation: the workflow table header uses a quoted key
      const original = readFileSync(join(tpl, "workflow.toml"), "utf8")
      const quoted = original.replace(/^\[workflow\][ \t]*$/m, '["workflow"]')
      assert.notEqual(quoted, original, "premise: the template's workflow header was rewritten to the quoted-key form")
      writeFileSync(join(tpl, "workflow.toml"), quoted)

      // premise: smol-toml — the run-time's own parser — reads the
      // [workflow] table from the quoted-key header
      const consumerSees = (parseToml(quoted) as { workflow?: unknown }).workflow
      assert.ok(
        consumerSees !== undefined,
        "premise: smol-toml parses the quoted-key [\"workflow\"] header into the workflow table",
      )

      const out = join(tmp, "program") // must NOT exist beforehand
      const r = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
        join(ROOT, "templates"),
      )
      const falsePremise = !r.ok && /no \[workflow\] table/.test(String((r as { why?: string }).why ?? ""))
      assert.ok(
        !falsePremise,
        `INV-2/INV-4 (a refusal's premise must survive the consumer's own read; the door's adopted law ` +
          `tests-31/tests-41: "refuse only when the consumer truly cannot read the landing"): the template ` +
          `declares its workflow table as ["workflow"] — a QUOTED table key, legal TOML; smol-toml (the read the ` +
          `pin-verify claims to speak for) parses workflow = ${JSON.stringify(consumerSees)} — yet the pin landing ` +
          `(pinIntoWorkflowTable's three arms: the tolerant header matcher /\\^\\[\\s*workflow\\s*\\]/, the dotted ` +
          `workflow.* arm, the single-line inline arm) matched NOTHING and prepareReview refused with ` +
          `"the template's workflow.toml has no [workflow] table" (ok=${String(r.ok)}, ` +
          `why=${(r as { why?: string }).why ?? "n/a"}) — a false premise. tests-31 pinned the trailing comment, ` +
          `tests-41 the interior spaces; the quoted key is the same law one token later on the same anchor. ` +
          `On BASE the door materialized this template (no pin-verify existed) — the false-premise REFUSAL is ` +
          `introduced by this change.`,
      )
      // any acceptance must land the pin where the consumer reads it
      if (r.ok && !("skipped" in r && r.skipped)) {
        const pinnedToml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
        assert.equal(
          (parseToml(pinnedToml) as { workflow?: { model?: string } }).workflow?.model,
          "acme/strong",
          "if accepted, the pin must land inside the workflow table the consumer reads",
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
