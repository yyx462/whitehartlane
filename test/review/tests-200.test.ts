import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

// the gate + its ledger ride the OS-disk trace — pin a private home and
// ledger before anything imports the store (the repo's repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests200-store-"))
process.env.WHL_GATE_LEDGER = join(process.env.AGENTIC_OS_HOME, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// BASE shape: the audit levy does not exist there — nothing to judge
const doorOwnsTheAudit = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")

// the gate module exists only on HEAD (guarded dynamic import, the
// momentum-14 device)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

function emptyDiffRepo(where: string): string {
  // feat = master + ONE EMPTY COMMIT: base..head resolves to a real,
  // non-identical headSha with a ZERO-FILE diff (`git commit --allow-empty`
  // is routine in automation: release toggles, CI re-triggers, revert
  // placeholders)
  mkdirSync(where, { recursive: true })
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "README.md"), "base\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  g("commit", "-q", "--allow-empty", "-m", "ci: re-trigger")
  return where
}

test("premise: an empty file list classifies docs_only, and a fresh class audits every skip", () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { classify } = gate as typeof import("../../src/doors/review-gate.ts")
  assert.equal(classify([], 0), "docs_only", "[].every() is true — the gate reads a zero-file diff as docs_only")
})

test("an AUDITED escalation is not dead-ended by the empty-diff skip — the twin of the momentum-15 fix", async () => {
  if (!doorOwnsTheAudit) return // BASE: no audit levy — nothing to judge

  const tmp = mkdtempSync(join(tmpdir(), "whl-tests200-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = emptyDiffRepo(join(tmp, "repo"))

    // the gate's own receipt for this input (fresh docs_only class →
    // rate 1.0 → the roll always audits): "dropout audit of docs_only —
    // full rail … DROPOUT AUDIT — the skip region stays measured".
    // The bin then levies with auditLevy: true (the audit's whole
    // purpose is the verdict — momentum-15).
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/strong", out, auditLevy: true },
      join(ROOT, "templates"),
    )

    const skipped = "skipped" in r && r.skipped === true
    assert.ok(
      !skipped,
      `INV-4 (claims are honest) / the momentum-15 law ("the ESCALATION still levies"): an empty diff ` +
        `classifies docs_only at the gate and a fresh class AUDITS every skip — the gate prints "dropout ` +
        `audit of docs_only — full rail" and the bin levies with auditLevy: true — but the door's EMPTY-DIFF ` +
        `skip (src/doors/review.ts: files.length === 0 → "empty diff") has NO auditLevy bypass, unlike its ` +
        `docs-only twin a few lines below (which this diff itself fixed with !args.auditLevy). The audited ` +
        `escalation is dead-ended: the operator sees BOTH "DROPOUT AUDIT — the skip region stays measured" ` +
        `AND "review: skip — empty diff (0 files; nothing levied)", no Job is booked, no verdict can exist ` +
        `for this headSha, the ledger row stays unlabeled forever, and greens can never accrue — the audit ` +
        `measures nothing while printing that it does. One decision ("may this skip stand under an ` +
        `audit?") — answered NO by the docs-only skip and YES by the empty-diff skip, in one function, ` +
        `by this change. Result: ${JSON.stringify(r).slice(0, 240)}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
  }
})
