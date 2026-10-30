import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

// The door's own law, stated in this very change (r20 tests-30): a
// template problem is a code-2 door REFUSAL, "never an escaped stack".
// smol-toml — the door's own parser — happily parses a SINGULAR
// `[stage]` table (legal TOML; the door's contract is [[stage]] arrays,
// and loadManifest would refuse it honestly downstream). But the
// roster post-verify reads `(parsedTemplate.stage ?? []).flatMap(...)`
// with no shape guard: with a gate roster (< 4 lenses) and such a
// template, prepareReview THROWS a raw TypeError out of the door
// instead of returning the documented { ok: false, code: 2 } refusal.
// Verified on HEAD: TypeError: (parsedTemplate.stage ?? []).flatMap is
// not a function — an escaped stack, exactly the shape the door's law
// forbids. bin/whitehartlane's review verb does not wrap prepareReview
// in a try, so the CLI dies on the stack.
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

test("a template the door cannot subset is REFUSED, never thrown out of the door", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests2006-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tplRoot = join(tmp, "tpl")
    const tpl = join(tplRoot, "pr-review")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    writeFileSync(
      join(tpl, "workflow.toml"),
      [
        "[workflow]",
        `name = "t2006"`,
        `worker_kind = "opencode"`,
        "",
        "[stage]", // singular table — legal TOML the door's own parser accepts
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [`,
        `  { id = "principles", brief = "p" },`,
        `  { id = "momentum", brief = "m" },`,
        `]`,
        "",
      ].join("\n"),
    )

    let out: unknown
    try {
      out = prepareReview(
        { repo, base: "master", head: "feat", model: "acme/strong", roster: ["principles"], out: join(tmp, "prog") },
        tplRoot,
      )
    } catch (err) {
      assert.fail(
        `the door must answer with a refusal, not throw. A singular [stage] table (legal TOML — ` +
          `smol-toml parses it, which is why the parse itself did not refuse) escapes the roster ` +
          `post-verify as ${(err as Error).constructor.name}: ${String((err as Error).message).split("\n")[0]} — ` +
          `the exact "escaped stack" the door's own law (r20 tests-30: template problems are code-2 ` +
          `refusals, never stacks) forbids, and bin/whitehartlane does not catch it.`,
      )
    }
    const r = out as { ok: boolean; why?: string; code?: number }
    // whichever way the door answers, it must answer THROUGH the door:
    // refuse (code 2, the honest subset refusal), or materialize and let
    // the run-time's loadManifest refuse downstream — never a thrown
    // TypeError out of prepareReview (BASE answers ok:true here, since it
    // has no roster seam; the throw is HEAD-only)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
