import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// INV-3 (one decision, one place) / INV-2 (refuse, never vanish) —
// "do the template's temperature pins have a model to ride?" is
// answered TWO ways inside the pin-plan block this diff built:
//
//   - the WITH-model arm verifies the landing with the CONSUMER'S OWN
//     READ — a smol-toml parse of the pinned bytes, demanding
//     parsed.workflow.model === args.model (review.ts:192-195). The
//     diff's own comment states the law: "a `model =` line in any
//     other table sailed the old regex verify while loadManifest read
//     workflow.model = undefined" — the r19 tests-1 receipt.
//   - the NO-model arm (review.ts:176) still answers the same question
//     with the TABLE-BLIND regex: hasModel = /^model\s*=/m.test(templateToml)
//     — a model line ANYWHERE, including a dead table no consumer reads.
//
// The path that breaks: a custom template (--template is a first-class
// door flag) carrying its model default in a non-[workflow] table —
// the natural shape for a lens/table default — and NO --model passed.
// The with-model arm would refuse this template (parsed.workflow.model
// !== args.model → "no [workflow] table" refusal). The no-model arm
// sails: hasModel=true, no refusal, ok:true — a materialized review
// whose workflow.toml keeps the pr-review temperature pins and whose
// [workflow].model (the consumer's own read) is UNDEFINED. Every lens
// spawn then refuses at the host ("temperature … has no model to pin
// against — refusing spawn", src/adapters/opencode-host.ts:95) — the
// exact four-lenses-late death this door block exists to refuse, and
// the exact spelling of the mistake the diff's own comment quotes as
// the receipt it fixed. One decision — "is there a model the pins can
// ride" — two predicates that disagree on the same template.
//
// On BASE the no-model arm carries the same table-blind regex (base
// review.ts else-branch), so the door fails there too: this repro
// classifies INCOMPLETE-FIX — the diff moved this exact predicate
// pre-materialization, wrote the consumer-read law into its comment,
// fixed the twin arm, and left this one table-blind.
test("the missing-model refusal sees the template the way the consumer does — a model outside [workflow] is not a model", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p12-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const out = join(tmp, "program") // must NOT exist beforehand
    const tpl = join(tmp, "tpl")
    cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
    // the ONLY model line now sits in a dead table; [workflow] carries none
    writeFileSync(
      join(tpl, "workflow.toml"),
      `[lens]\nmodel = "old/lens-default"\n\n` + readFileSync(join(tpl, "workflow.toml"), "utf8"),
    )

    // NO --model: the door must judge the template the way the run-time
    // does — loadManifest reads [workflow].model and nothing else.
    const r = prepareReview({ repo, base: "master", head: "feat", out, template: tpl }, join(ROOT, "templates"))
    const consumerModel = r.ok && !("skipped" in r && r.skipped)
      ? (loadManifest(r.dir).workflow as { model?: string }).model
      : undefined

    assert.equal(
      r.ok,
      false,
      `INV-3/INV-2: "do the template's temperature pins have a model to ride?" is answered two opposite ways in ` +
        `one block. The WITH-model arm verifies with the consumer's own read (review.ts:192-195, smol-toml parse, ` +
        `parsed.workflow.model === args.model — its comment cites the r19 receipt: "a model = line in any other ` +
        `table sailed the old regex verify while loadManifest read workflow.model = undefined"). The NO-model arm ` +
        `(review.ts:176) answers the SAME question with the TABLE-BLIND /^model\\s*=/m — and a template whose only ` +
        `model line sits in a dead table sails it: the door returned ok=true and materialized ${out} with the ` +
        `pr-review temperature pins and loadManifest(dir).workflow.model=${JSON.stringify(consumerModel)} — no ` +
        `model where the consumer reads, so every lens spawn refuses at the host (opencode-host.ts:95), the ` +
        `four-lenses-late death this block exists to refuse. The diff fixed the twin arm of this exact decision ` +
        `and left this one table-blind: the incomplete-fix class.`,
    )
    // the positive form of the law, for the record: either the door
    // refuses, or the materialized program's own consumer read finds a model
    assert.ok(
      !r.ok || consumerModel !== undefined,
      `INV-2 refuse-never-vanish: the door accepted a temperature-pinned template whose consumer read ` +
        `(loadManifest [workflow].model) is ${JSON.stringify(consumerModel)} — the pin-less program ships to die ` +
        `four lenses late at the host's spawn refusal`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
