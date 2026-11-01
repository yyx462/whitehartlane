import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// MOMENTUM (an ordering that only holds on the happy path) / INV-4 —
// the audited escalation has TWO arms for "the class flipped under it"
// (a diff that changes between the gate's read and the levy's read),
// and they are answered OPPOSITELY in the same function:
//
//   review.ts:381  EMPTY diff  + auditLevy → FALLS THROUGH and levies.
//     The change's own law, verbatim: "the audit measures the judgment
//     the gate made on the diff it saw; an all-green verdict on nothing
//     accrues honestly — rather than dead-ending with a ledger row
//     claiming audit:true and nothing levied".
//   review.ts:399  DOCS-ONLY diff (files.length > 0) → UNCONDITIONAL
//     skip, auditLevy never consulted. The audited escalation
//     dead-ends: the ledger row already written by runGate says
//     action:"skip" + audit:true, and nothing is measured — the exact
//     dead-end shape the empty-diff arm was written to end
//     (gate-r8 tests-1's shape), and the exact law review-gate.ts's
//     header states ("the skip region is never unmeasured; that is the
//     whole point of the dropout").
//
// The path that breaks: an audited skip whose diff goes docs-only
// between the gate's read and the levy's. The shipped `--gate-only`
// verb makes this window caller-controlled, not millisecond-scale: the
// gate runs (row written, decision "skip + audit" on a code diff), the
// caller levies later, and a commit/force-push landing in between turns
// the diff docs-only. The door then skips, the bin prints the skip
// receipt and exits 0, and the audit the ledger promised never runs.
//
// On BASE there is no auditLevy at all — the broken arm is introduced
// by this change (the guard below keeps the repro vacuous there).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")) {
  test("momentum-26: BASE — no audit levy, nothing to judge", () => {})
} else {
  // repo whose master..feat diff is EXACTLY one docs file
  function docsOnlyRepo(where: string): string {
    const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
    mkdirSync(join(where, "src"), { recursive: true })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
    writeFileSync(join(where, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    // the flip landing: the head commit touches ONLY docs — the diff the
    // levy reads is docs-only, the diff the gate read was code
    writeFileSync(join(where, "README.md"), "docs only change\n")
    g("add", "-A")
    g("commit", "-q", "-m", "docs")
    return where
  }

  // repo whose master..feat diff is EMPTY (feat == master) — the twin
  // arm's own premise, materializing today per review.ts:381
  function emptyDiffRepo(where: string): string {
    const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
    mkdirSync(join(where, "src"), { recursive: true })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    // an EMPTY commit: base != head (the same-commit guard is upstream)
    // but the diff is [] — the empty-diff arm's own premise
    g("commit", "-q", "--allow-empty", "-m", "empty")
    return where
  }

  test("an audited escalation whose class flipped to docs-only under it still levies — the door's own empty-diff law", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m26-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = docsOnlyRepo(join(tmp, "repo"))
      const r = prepareReview(
        { repo, base: "master", head: "feat", auditLevy: true, model: undefined, out },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `INV-4 (the change's own claim is false — one decision, two opposite arms): an audited escalation ` +
          `whose diff flipped to docs-only between the gate's read and the levy's is SWALLOWED at ` +
          `review.ts:399-400 (the docs-only skip is unconditional; auditLevy is never consulted) and returns ` +
          `${JSON.stringify(r)} — but review.ts:381's empty-diff arm states the law for the identical race: ` +
          `"the audit measures the judgment the gate made on the diff it saw … rather than dead-ending with a ` +
          `ledger row claiming audit:true and nothing levied (gate-r8 tests-1's shape)". runGate already wrote ` +
          `that ledger row (action:"skip", audit:true) when it saw the code diff; this skip levies nothing, so ` +
          `the row measures a dropout sample that never ran — no verdict, no label, no greens, the skip region ` +
          `unmeasured (review-gate.ts's own header law: "the skip region is never unmeasured; that is the whole ` +
          `point of the dropout"). Reachable without any millisecond race: the shipped --gate-only verb splits ` +
          `the gate's read from the levy across caller-controlled time. The docs-only arm must fall through for ` +
          `an audited levy exactly as the empty arm does (or the audit row must not be written before the door ` +
          `decides) — the two arms of "the class flipped under it" must answer the same.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("premise: the same audited levy materializes when the flip lands on an EMPTY diff (the twin arm's law)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-m26b-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = emptyDiffRepo(join(tmp, "repo"))
      const r = prepareReview(
        { repo, base: "master", head: "feat", auditLevy: true, model: undefined, out },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `premise: review.ts:381's empty-diff arm falls through for an audited levy and materializes the program; ` +
          `got ${JSON.stringify(r)} — the law the docs-only arm (review.ts:399) must share`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
