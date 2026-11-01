import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { loadManifest } from "../../src/doors/hooks.ts"
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

// INV-3 (one decision, one place — "is there a [workflow] table the pin
// can land in?") / INV-4 (the door's verdict is honest) / the diff's own
// adopted law (tests-31: "the door never refuses a template whose
// [workflow] table the consumer reads"; questions-4-r22 carried it to
// the dotted-key form) / the pin-landing comment's own claim
// (review.ts:67-72: "every parseable form lands … (a literal header,
// dotted keys, AN INLINE TABLE)").
//
// TOML declares a table with an INLINE TABLE too:
//
//     workflow = { name = "pr-review", worker_kind = "opencode", … }
//
// smol-toml — the run-time's own parser, the read the pin-verify's
// comment claims to speak for — parses it into a working workflow table
// byte-for-byte like the header form. pinIntoWorkflowTable has only TWO
// arms: the `[workflow]` header line and `workflow.` dotted keys. An
// inline-table template hits neither, the landing helper returns
// undefined, and the door refuses with
//
//     "the template's workflow.toml has no [workflow] table"
//
// — a FALSE premise (the consumer reads the table) prescribing a fix
// that cannot be performed ("add a [workflow] table" — it HAS one). The
// comment claims the inline-table form lands; the code never shipped
// the arm: the incomplete-fix class, one shape later than
// questions-4-r22.
//
// On BASE the repro passes by construction: BASE had no pin-verify at
// all (the pin silently vanished with ok:true — the INV-2 hole this
// diff exists to close), so no false-premise refusal existed to judge.
test("the door never refuses a template whose [workflow] table the consumer reads (inline-table form)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p15-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))

    // ── control: the header form materializes and the pin lands where
    // the consumer reads it (proves the harness)
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

    // ── the SAME template with the [workflow] table declared as ONE
    // inline table: legal TOML, identical parsed shape
    const tpl = join(tmp, "tpl-inline")
    cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
    const original = readFileSync(join(tpl, "workflow.toml"), "utf8")
    const parsed = parseToml(original) as { workflow?: Record<string, unknown> }
    assert.ok(parsed.workflow, "premise: the template's workflow table parses")
    const scalar = (v: unknown): string =>
      typeof v === "string" ? JSON.stringify(v) : String(v)
    const inlineLine =
      `workflow = { ${Object.entries(parsed.workflow!)
        .map(([k, v]) => `${k} = ${scalar(v)}`)
        .join(", ")} }\n`
    const lines = original.split("\n")
    const headerIdx = lines.findIndex((l) => /^\[workflow\]/.test(l))
    let end = headerIdx + 1
    while (end < lines.length && !/^\[/.test(lines[end])) end++
    const inlineToml = [inlineLine, ...lines.slice(0, headerIdx), ...lines.slice(end)].join("\n")
    writeFileSync(join(tpl, "workflow.toml"), inlineToml)
    const consumerRead = (() => {
      try {
        return (parseToml(inlineToml) as { workflow?: unknown }).workflow
      } catch {
        return undefined
      }
    })()
    assert.ok(
      consumerRead !== undefined,
      "premise: smol-toml — the run-time's own parser — reads a [workflow] table from the inline-table form",
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
      `INV-3/INV-4: "is there a [workflow] table the pin can land in?" is answered by TWO sites that ` +
        `disagree: the door's textual anchor (pinIntoWorkflowTable — the [workflow] header arm and the ` +
        `workflow.* dotted-key arm, nothing else) and the consumer's own parse. The template declares its ` +
        `[workflow] table as ONE INLINE TABLE — smol-toml parses workflow = ${JSON.stringify(consumerRead)} — ` +
        `yet the door refused with "the template's workflow.toml has no [workflow] table" ` +
        `(ok=${String(r.ok)}, why=${(r as { why?: string }).why ?? "n/a"}): a false premise whose prescribed ` +
        `fix ("add a [workflow] table to the template") cannot be performed — the template HAS one. ` +
        `The landing comment (review.ts:67-72) claims "every parseable form lands … (a literal header, ` +
        `dotted keys, an inline table)"; the inline-table arm does not exist — the change's own claim is ` +
        `false, the same law tests-31 pinned (trailing comment, [[stage]] overshoot) and questions-4-r22 ` +
        `carried one shape later (dotted keys). Refuse only when the consumer truly cannot read the landing.`,
    )
    // any acceptance must still land the pin where the consumer reads it —
    // judged only where the door OWNS that contract (the pin-verify
    // exists); BASE's door accepted and silently dropped the pin (the
    // pre-diff INV-2 hole), so BASE is judged only on the refusal above
    const doorOwnsThePin = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes(
      "pinIntoWorkflowTable",
    )
    if (doorOwnsThePin && r.ok && !("skipped" in r && r.skipped)) {
      const manifest = loadManifest((r as { dir: string }).dir)
      assert.equal(
        manifest.workflow?.model,
        "acme/strong",
        "if the door accepts the inline-table template, the pin must land in the workflow table the consumer reads",
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
