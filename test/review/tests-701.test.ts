import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

// INV-4 (the change's own claim is false): review-gate.ts:15-16 —
//   "The gate can only loosen as greens accumulate; a red in a skipped
//    class re-tightens it"
// and the classStats doctrine (review-gate.ts:186-187) —
//   "fresh class → audit every skip; greens decay it; any red resets it
//    to every-skip (drift alarm)".
// A RESET must be re-decayable: that is what "reset" means, and it is
// what makes the dropout economics a loop instead of a one-shot. The
// formula (review-gate.ts:199) short-circuits permanence:
//
//   rate = reds > 0 || greens < 3 ? 1.0 : greens < 8 ? 0.25 : 0.1
//
// reds counts EVERY skip row ever labeled red — the ledger is
// append-only and nothing ages rows out — so ONE red anywhere in the
// class's machine-lifetime history pins the rate at 1.0 no matter how
// many greens accumulate after it. The reachable path is the NORMAL
// path: a fresh class audits every skip (rate 1.0), the audit levies
// the full rail, and a rail that finds a real bug writes a red verdict
// for that headSha — from then on the class audits every skip forever.
// "The gate can only loosen as greens accumulate" is false for every
// class that ever caught a real problem — the loosening the whole
// decay loop exists for is dead code on any working machine, and the
// receipt keeps printing "audit p=1 (greens N/reds 1)" forever.
test("after a red, re-accumulated greens must decay the audit rate again", () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { classStats } = gate as typeof import("../../src/doors/review-gate.ts")

  const row = (headSha: string) => ({
    ts: "t", repo: "r", head: "h", headSha, klass: "code_small",
    files: 1, churn: 1, hot: [], ps: null, roster: [], action: "skip", audit: true,
  })
  // the drift alarm fires (a red resets the class)…
  const rows = [row("red-1")]
  const labels = new Map([["red-1", { red: true }]])
  // …and then the class re-earns trust: eight green audited skips in a
  // row — past even the deepest decay threshold (greens >= 8 → 0.1)
  for (let i = 0; i < 8; i++) {
    rows.push(row(`green-${i}`))
    labels.set(`green-${i}`, { red: false })
  }

  const stats = classStats(rows, labels, "code_small")
  assert.equal(stats.reds, 1, "sanity: the red is in the class's history")
  assert.equal(stats.greens, 8, "sanity: eight greens accumulated after the red")
  assert.ok(
    stats.rate < 1.0,
    `INV-4 (the module's own stated law is false): review-gate.ts:15-16 promises "The gate can only loosen ` +
      `as greens accumulate; a red in a skipped class re-tightens it", and :186-187 promises "greens decay ` +
      `it; any red RESETS it to every-skip" — but the rate formula (:199, \`reds > 0 || greens < 3 ? 1.0 : …\`) ` +
      `counts every red the append-only ledger has ever recorded, with no aging and no path back: after ONE ` +
      `red (the normal product of a fresh class auditing every skip — the audit levies the rail, the rail ` +
      `finds a real bug, the verdict is red), greens=${stats.greens} and reds=${stats.reds} still yield ` +
      `rate=${stats.rate}. A reset that can never re-decay is not a reset — it is a permanent lock; the ` +
      `documented loosening is dead code on every class that ever caught a real problem, and every code-class ` +
      `skip audits the full 4-lens rail forever. Age the reds (recency window) or decay past them — but make ` +
      `the stated law true.`,
  )
})
