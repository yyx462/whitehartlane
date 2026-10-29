import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// PRINCIPLES (twin paths) / INV-3 + INV-4 — the audited escalation has
// TWO arms answering "the class flipped under it" (the diff changed
// between the gate's read and the levy's), and they answer OPPOSITELY:
//
//   review.ts  empty-diff arm   + auditLevy → FALLS THROUGH, levies
//               ("the audit measures the judgment the gate made on the
//               diff it saw … rather than dead-ending with a ledger row
//               claiming audit:true and nothing levied")
//   review.ts  docs-only arm    + auditLevy → UNCONDITIONAL skip —
//               auditLevy is never consulted
//
// runGate has ALREADY written the ledger row (action:"skip",
// audit:true) when it read a code diff; a flip to docs-only before the
// levy (caller-controlled time via the shipped --gate-only verb, or a
// force-push) makes the door skip with exit 0 and NOTHING measures the
// skip — no verdict, no label, no greens — the exact dead-end shape the
// empty-diff arm was written to end. One decision ("does an audited
// escalation still levy when its class flipped under it?"), two sites,
// two opposite answers: the docs-only arm must fall through for an
// audited levy exactly as the empty arm does.
//
// Introduced by this change (BASE has no auditLevy at all — the guard
// below keeps this repro vacuous green there).
if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")) {
  test("principles-36: BASE — no audit levy, nothing to judge", () => {})
} else {
  // master..feat differs by exactly one docs file — the flipped class,
  // materialized on disk so no race needs simulating
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
    writeFileSync(join(where, "README.md"), "docs only change\n")
    g("add", "-A")
    g("commit", "-q", "-m", "docs")
    return where
  }

  test("an audited levy whose diff is docs-only still levies — the docs-only arm must answer as the empty-diff arm does", () => {
    const tmp = mkdtempSync(join(tmpdir(), "whl-p36-"))
    const out = join(tmp, "program") // must NOT exist beforehand
    try {
      const repo = docsOnlyRepo(join(tmp, "repo"))
      const r = prepareReview(
        { repo, base: "master", head: "feat", auditLevy: true, model: undefined, out },
        join(ROOT, "templates"),
      )
      assert.ok(
        r.ok && !("skipped" in r && r.skipped),
        `INV-3/INV-4 (one decision, two opposite arms; the ledger row the gate wrote now measures nothing): ` +
          `an audited escalation whose diff is docs-only at levy time is SWALLOWED by the door's unconditional ` +
          `docs-only skip (review.ts — auditLevy is never consulted there) and returned ${JSON.stringify(r)}. ` +
          `The empty-diff arm of the same predicate states the law for the identical flip ("the audit measures ` +
          `the judgment the gate made on the diff it saw … rather than dead-ending with a ledger row claiming ` +
          `audit:true and nothing levied"), and runGate has already written that row by the time the levy runs ` +
          `(the shipped --gate-only verb makes the gap caller-controlled). The audit dead-ends: no verdict, no ` +
          `label, no greens — the skip region the row promises to measure stays unmeasured, and the gate's ` +
          `dropout can never loosen on this sample. The docs-only arm must fall through for an audited levy ` +
          `exactly as the empty-diff arm does.`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
