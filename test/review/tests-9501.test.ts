import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the momentum-14 device): the roster seam is this
// diff's own addition — on BASE `roster` is not a door field, the
// guarded scenario cannot arise, and this repro is vacuous green there.
const doorHasRoster = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("stripUnitsToRoster")

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

// A LEGAL template whose parse reads ZERO stage units — a [workflow]
// table only (the shape questions-14 materializes: the door's own parse
// handles these bytes; zero-units is a doctrine refusal, not a parse
// failure). With NO roster the door refuses it late (the handoff
// block) but leaves a RECOGNIZABLE program dir (data/review exists) —
// the replace-guard re-run stays alive. With an EMPTY roster the door
// takes a DIFFERENT refusal site: `if (args.roster && args.roster.length
// === 0) return` — seated AFTER mkdirSync+cpSync (review.ts:762-763)
// but BEFORE data/review is created (review.ts:799). The leftover dir
// carries workflow.toml and NO data/review — the replace-guard's own
// predicate (`ours = workflow.toml && data/review`, review.ts:753-757)
// then classifies it "not a materialized review program" and refuses
// the re-run at the same --out: the recovery the refusal's own receipt
// implies (fix the roster, re-run) is dead-ended, and the user must
// hand-delete a dir that, on the default --out, sits INSIDE the repo
// under review. This diff's own adopted law (tests-13, momentum-9 —
// both quoting the #251 review's principles-2, whose fix comment sits
// at review.ts:571): a refusal that fires after mkdir+cpSync "leav[es]
// a half-built dir the replace-guard then refused to replace — the
// recovery the message itself prescribed was dead-ended". The diff
// moved TWO refusals pre-materialization for exactly this disease and
// added a third with it (the empty-roster guard). Meta-ACH: empty
// input (roster = []), zero units (template declares none).
test("the empty-roster refusal leaves nothing in --out — the prescribed re-run stays alive", () => {
  if (!doorHasRoster) return // BASE: no roster seam — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-t9501-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = join(tmp, "tpl")
    mkdirSync(tpl, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tpl, doc), "# seed\n")
    }
    // a units-less template: the only shape where an empty roster
    // reaches the guard (with units, the survivors check refuses
    // pre-materialization at review.ts:681)
    writeFileSync(
      join(tpl, "workflow.toml"),
      [`[workflow]`, `name = "t9501"`, `worker_kind = "opencode"`, ``].join("\n"),
    )

    const r1 = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", roster: [], out, template: tpl },
      join(ROOT, "templates"),
    )
    assert.equal(
      r1.ok,
      false,
      "sanity: an empty roster must be refused (a skip, not a zero-lens review)",
    )

    // THE LAW: the refusal must leave NOTHING in --out, so the recovery
    // its own receipt implies (fix the roster/gate drift, re-run at the
    // same --out) stays alive — the tests-13/momentum-9 half-built-dir
    // law this diff itself wrote into review.ts:571's comment.
    assert.ok(
      !existsSync(out),
      `INV-2/recovery law (the diff's own comment at review.ts:571, quoting principles-2: a refusal ` +
        `after mkdir+cpSync "leav[es] a half-built dir the replace-guard then refused to replace — the ` +
        `recovery the message itself prescribed was dead-ended"): the empty-roster guard (review.ts:769-771) ` +
        `fires AFTER mkdirSync+cpSync (review.ts:762-763) and BEFORE data/review is created (review.ts:799), ` +
        `so the refusal left a half-built dir at ${out} ` +
        `(exists=${existsSync(out)}, workflow.toml=${existsSync(join(out, "workflow.toml"))}, ` +
        `data/review=${existsSync(join(out, "data", "review"))}). The replace-guard (review.ts:753-757, ` +
        `"ours = workflow.toml && data/review") now classifies that leftover as "not a materialized review ` +
        `program" and refuses the re-run the refusal's own receipt prescribes — the user must hand-delete a ` +
        `dir that on the default --out sits INSIDE the repo under review. The diff moved the missing-model ` +
        `refusal pre-materialization for exactly this disease (principles-2, review.ts:571) and its adopted ` +
        `repros tests-13/momentum-9 pin the class; the empty-roster guard is a third site with it.`,
    )

    // the dead-end, demonstrated: exactly the prescribed recovery —
    // fix the input, re-run at the SAME --out — must be accepted.
    const tplFixed = join(tmp, "tpl-fixed")
    mkdirSync(tplFixed, { recursive: true })
    for (const doc of ["REVIEWER.md", "SCHEMA.md", "INVARIANTS.template.md", "QUESTIONS.template.md"]) {
      writeFileSync(join(tplFixed, doc), "# seed\n")
    }
    writeFileSync(
      join(tplFixed, "workflow.toml"),
      [
        `[workflow]`,
        `name = "t9501"`,
        `worker_kind = "opencode"`,
        ``,
        `[[stage]]`,
        `id = "lenses"`,
        `topology = "fan-out"`,
        `units = [{ id = "principles", brief = "b" }]`,
        ``,
      ].join("\n"),
    )
    const r2 = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, template: tplFixed },
      join(ROOT, "templates"),
    )
    assert.equal(
      r2.ok,
      true,
      `INV-2/recovery law: the prescribed recovery — fix the input, re-run at the SAME --out — is ` +
        `dead-ended by the replace-guard: r2.ok=${String(r2.ok)}, why=${r2.ok ? "n/a" : (r2 as { why?: string }).why}. ` +
        `The half-built dir from the empty-roster refusal (workflow.toml without data/review) fails the ` +
        `guard's own "ours" predicate, so the door refuses to replace the very debris its previous refusal ` +
        `left. tests-13 pinned this exact shape for the pin-verify refusal and the fix moved that refusal ` +
        `pre-materialization; the empty-roster guard re-introduces it one guard later.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
