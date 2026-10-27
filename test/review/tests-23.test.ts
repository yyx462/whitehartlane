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

// INV-2 (an accepted field reaches its consumer — refuse, never
// vanish) / INV-3 (the verify and the consumer must answer "did the
// pin land?" identically). The diff's pin-plan (review.ts:144-172) is
// ONE computation with a verify whose refusal fires when
// `/^model\s*=/m` does not match the pinned bytes — i.e. it proves a
// model line exists SOMEWHERE, not that it landed inside the
// [workflow] table the run-time reads. The replace branch
// (review.ts:158) rewrites the FIRST `model =` line in file order —
// whatever table it sits in. A template carrying `model = "..."` in
// any other table (reachable through the first-class --template flag;
// a lens/table default is the natural way one appears) therefore:
// verify PASSES (a model line exists), door returns ok:true, the pin
// lands in the dead table — and loadManifest(dir).workflow.model is
// UNDEFINED. The pr-review template pins per-unit temperatures, so
// every lens spawn then refuses at birth (src/adapters/opencode-host.ts:95
// "no unit/stage/workflow model — refusing spawn"): the exact
// four-lenses-late death the verify's own comment promises cannot
// happen ("the pin lands iff the template has a model line (replaced)
// or a [workflow] header (inserted after). Neither → refuse before
// mkdir" — review.ts:140-143). One decision — "will the pin land where
// the consumer reads it?" — the verify answers YES, the manifest
// answers NO.
//
// Control: the default template (no model line anywhere) inserts the
// pin after [workflow] and the consumer reads it back — the bug is the
// replace branch's table-blindness, not the insert branch.
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

test("the pin-verify proves the model lands where the consumer reads it, not just that some model line exists", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests23-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))

    // ── control: the default template — the pin lands under [workflow]
    const outOk = join(tmp, "program-ok")
    const ok = prepareReview({ repo, base: "master", head: "feat", model: "acme/strong", out: outOk }, join(ROOT, "templates"))
    assert.ok(ok && !("skipped" in ok && ok.skipped), `sanity: the default template materializes: ${JSON.stringify(ok)}`)
    if (ok && !("skipped" in ok && ok.skipped)) {
      assert.equal(
        loadManifest(ok.dir).workflow?.model,
        "acme/strong",
        "sanity: the control — a template with NO model line — lands the pin where the consumer reads it",
      )
    }

    // ── the hole: a template whose ONLY model line sits in another
    // table (the [lens] default a custom rail template plausibly
    // carries; prepended so it precedes everything else)
    const tpl = join(tmp, "tpl")
    cpSync(join(ROOT, "templates", "pr-review"), tpl, { recursive: true })
    writeFileSync(
      join(tpl, "workflow.toml"),
      `[lens]\nmodel = "old/lens-default"\n\n` + readFileSync(join(tpl, "workflow.toml"), "utf8"),
    )

    const out = join(tmp, "program") // must NOT exist beforehand
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tpl },
      join(ROOT, "templates"),
    )
    if (!r.ok) {
      // a refusal is ALSO an acceptable fix — but then it must be a
      // door refusal that names the landing problem, not some later
      // crash
      assert.match((r as { why?: string }).why ?? "", /model|workflow/i, "if refused, the refusal must name the model/workflow landing")
      return
    }
    const manifest = loadManifest(r.dir)
    assert.equal(
      manifest.workflow?.model,
      "acme/strong",
      `INV-2/INV-3: the pin-verify (review.ts:163) proves only that SOME model line exists — its replace branch ` +
        `(review.ts:158, /^model\\s*=.*$/m first-match) rewrote the template's model line INSIDE ITS OWN TABLE ` +
        `([lens]), which no consumer reads. The door returned ok:true while loadManifest(dir).workflow.model is ` +
        `${JSON.stringify(manifest.workflow?.model)} — the accepted --model never reaches its engine, and the ` +
        `pr-review temperature pins send every lens spawn to opencode-host.ts:95's refusal ("no unit/stage/workflow ` +
        `model"), the four-lenses-late death the verify's own comment (review.ts:140-143, "the pin lands iff the ` +
        `template has a model line (replaced) or a [workflow] header (inserted after)") promises cannot happen. ` +
        `The verify must check the model landed inside the [workflow] table (or the replace must be ` +
        `[workflow]-scoped, or a model line outside [workflow] must refuse) — refuse, never vanish.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
