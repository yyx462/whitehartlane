// momentum-2001 — the stop rule's REASON is false about the numbers it
// reports.
//
// The stop rule (src/doors/stop-rule.ts, NEW in this change) computes the
// owner's diminishing-returns FACT and ships a `why` string with it. That
// string is the HONESTY TRAIL: `whl ship` prints it to the owner
// ("ship: the gate's stop rule — …") and the gate ledger records it FOREVER
// beside the override (LedgerRow.stop). The PR comment carries it too
// (overruleComment's "The gate's stop rule at merge time: *…*").
//
// The DECISION is computed over the WINDOW (the last cfg.rounds rounds):
// `quiet` asks every window round to be quiet against ITS predecessor. But
// the REASON chain reasons about a DIFFERENT scope: `novel` and `stuck` are
// computed over the LAST TWO rounds only, and the `why` picks its branch
// from those two numbers.
//
// So whenever the WINDOW blocks the rule for a reason the last-two rounds do
// not show — a bucket that persisted one round further back — the `why` falls
// through to its last branch and prints a demonstrably FALSE statement:
// "novel 1 > 1" (1 is not greater than 1). The owner is told "new mechanisms
// keep appearing; the loop is not diminishing" when in fact the novel count is
// INSIDE the bound and the real blocker was a since-fixed stuck bucket.
//
// THE PATH (reachable, ordinary): a fixer fixes a bucket (round 2 → round 3
// drops it) and a NEW bucket appears one round later. The window still sees
// the round-2 predecessor overlap and refuses; the last-two rounds see
// nothing stuck.
//
// INV-4: verdicts are honest — the reason the owner records forever must be
// true about the numbers it reports.
//
// BASE behaviour: src/doors/stop-rule.ts does not exist on BASE → the import
// fails → the assertion below cannot pass there (the seat is introduced by
// this diff).
import assert from "node:assert/strict"
import test from "node:test"

const f = (id: string, file: string, line: number, severity = "P1") => ({
  id,
  severity,
  location: { file, line_start: line },
})

test("momentum-2001: the stop rule's reason must be true about the numbers it reports", async () => {
  const mod = (await import("../../src/doors/stop-rule.ts").catch(() => null)) as
    | typeof import("../../src/doors/stop-rule.ts")
    | null
  assert.ok(mod, "the stop rule's seat must exist — and its reason must be true")
  const { stopEligibility, DEFAULT_STOP } = mod

  // round 1: a.ts:0
  // round 2: a.ts:0 (the SAME bucket — it persisted) + b.ts:0 (new)
  // round 3: c.ts:0 (a.ts:0 is FIXED, c.ts:0 is new)
  const history = [
    [f("r1-1", "src/a.ts", 1)],
    [f("r2-1", "src/a.ts", 2), f("r2-2", "src/b.ts", 1)],
    [f("r3-1", "src/c.ts", 1)],
  ]
  const e = stopEligibility(history, DEFAULT_STOP)

  // the facts the reason must agree with
  assert.equal(e.novel, 1, "the last round's only bucket is new")
  assert.deepEqual(e.stuck, [], "the last round shares no bucket with the round before it")
  assert.ok(e.novel <= DEFAULT_STOP.novelMax, "the novel count is INSIDE the bound")

  // the reason may not claim a bound it did not break
  assert.ok(
    !/novel 1 > 1/.test(e.why),
    `the stop rule's reason must be TRUE: it says "${e.why}" but novel is ${e.novel} and the bound is ${DEFAULT_STOP.novelMax} — the real blocker is a stuck bucket one round further back, and the owner is told to chase new mechanisms that never appeared`,
  )
})
