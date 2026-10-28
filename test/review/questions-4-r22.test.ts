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

// QUESTIONS.md #3 (an accepted field reaches its consumer) / INV-4 (the
// door's verdict is honest) / the diff's OWN adopted law
// (test/review/tests-31.test.ts: "the door never refuses a template
// whose [workflow] table the consumer reads — refuse only when the
// consumer truly cannot read the landing").
//
// The pin-verify's landing helper (src/doors/review.ts
// pinIntoWorkflowTable, review.ts:65-91) anchors exclusively on a
// textual `[workflow]` TABLE HEADER. TOML also declares tables with
// DOTTED KEYS: a template opening
//
//     workflow.name = "pr-review"
//     workflow.worker_kind = "opencode"
//
// has a [workflow] table under TOML semantics, and the run-time's own
// parser — smol-toml, the same read loadManifest performs (review.ts:23
// imports it; the verify's own comment at review.ts:210-211 claims
// "the verification is the consumer's own read") — parses it into
// { workflow: { name, worker_kind } } byte-for-byte like the header
// form. The consumer reads the table; the anchor does not: headerIdx
// is -1, pinIntoWorkflowTable returns undefined, parsed stays
// undefined, and prepareReview refuses with
//
//     "the template's workflow.toml has no [workflow] table"
//
// (review.ts:230-236) — a false premise. tests-31 pinned exactly this
// class for two shapes (a trailing comment after the header, an
// [[stage]] span overshoot); the dotted-key shape is the same law one
// shape later, and the diff touched this exact decision (the tolerant
// header matcher at review.ts:67-68 carries the tests-31 receipt) and
// left this shape wrong: the incomplete-fix class. On BASE the door
// had no pin-verify at all, so no false-premise refusal existed — the
// repro below passes there by construction (no refusal to judge) and
// fails on HEAD.
test("the pin-verify never refuses a template whose [workflow] table the consumer reads (dotted-key form)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-q4-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))

    // ── control: the header form materializes and the pin lands where
    // the consumer reads it (proves the harness, both shapes of repo)
    const hdrTpl = join(tmp, "tpl-header")
    cpSync(join(ROOT, "templates", "pr-review"), hdrTpl, { recursive: true })
    const hdrOut = join(tmp, "program-header")
    const ctrl = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out: hdrOut, template: hdrTpl },
      join(ROOT, "templates"),
    )
    assert.ok(
      ctrl.ok && !("skipped" in ctrl && ctrl.skipped),
      `sanity: the header-form template materializes (got ${JSON.stringify(ctrl)})`,
    )

    // ── the same template with the [workflow] table declared in the
    // dotted-key form: legal TOML, identical parsed shape
    const tpl = join(tmp, "tpl-dotted")
    cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
    const original = readFileSync(join(tpl, "workflow.toml"), "utf8")
    const dotted = original
      .replace(/^\[workflow\][^\S\n]*\r?\n/m, "")
      .replace(/^name\s*=/m, `workflow.name =`)
      .replace(/^worker_kind\s*=/m, `workflow.worker_kind =`)
      .replace(/^slots\s*=/m, `workflow.slots =`)
      .replace(/^model\s*=/m, `workflow.model =`)
      .replace(/^spur_id\s*=/m, `workflow.spur_id =`)
    writeFileSync(join(tpl, "workflow.toml"), dotted)
    const consumerRead = (() => {
      try {
        return (parseToml(dotted) as { workflow?: unknown }).workflow
      } catch {
        return undefined
      }
    })()
    assert.ok(
      consumerRead !== undefined,
      "premise: smol-toml — the run-time's own parser — reads a [workflow] table from the dotted-key form",
    )

    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    const falsePremise =
      !r.ok && /no \[workflow\] table/.test(String((r as { why?: string }).why ?? ""))
    assert.ok(
      !falsePremise,
      `INV-4 (the door's verdict is honest) / tests-31's adopted law ("the door never refuses a template ` +
        `whose [workflow] table the consumer reads"): the template declares its [workflow] table with TOML ` +
        `dotted keys — the run-time's own parser (smol-toml, the read the pin-verify's comment at review.ts:210-211 ` +
        `claims to speak for) parses workflow = ${JSON.stringify(consumerRead)} — yet the pin-verify refused with ` +
        `"the template's workflow.toml has no [workflow] table" (ok=${String(r.ok)}, ` +
        `why=${(r as { why?: string }).why ?? "n/a"}). pinIntoWorkflowTable (review.ts:65-91) anchors only on a ` +
        `textual [workflow] HEADER line, so a table the consumer reads is invisible to the anchor and the door ` +
        `ships a false premise — the same class tests-31 pinned (trailing comment, [[stage]] overshoot) one ` +
        `shape later: refuse only when the consumer truly cannot read the landing, and never on a premise the ` +
        `consumer's own read falsifies.`,
    )
    // any acceptance must still land the pin where the consumer reads it —
    // but only where the door OWNS that contract (the pin-verify exists):
    // BASE's door accepted and silently dropped the pin, the pre-diff
    // INV-2 hole this diff's verify exists to close, so BASE is judged
    // only on the false-premise refusal above
    const doorOwnsThePin = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes(
      "pinIntoWorkflowTable",
    )
    if (doorOwnsThePin && r.ok && !("skipped" in r && r.skipped)) {
      const pinned = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
      assert.match(
        pinned,
        /model = "acme\/strong"/,
        "if the door accepts the dotted-key template, the pin must land in the workflow table the consumer reads",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
