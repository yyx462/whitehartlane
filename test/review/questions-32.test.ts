// questions-32 (questions lens, Q2/Q3) — THE STOP RULE'S TWO SEATS
// DISAGREE: the module and the cold twin answer the SAME question
// ("is this PR's review loop at diminishing returns?") with different
// answers for the same history.
//
// The change adds the criterion TWICE (INV-3: one function per
// decision) and CLAIMS the two agree. src/doors/stop-rule.ts:309-313
// (the door's seat, the module):
//
//   // history = one entry per round, OLDEST FIRST, each the round's
//   // blocked findings. The eligibility reads the LAST cfg.rounds
//   // rounds; novelty/stuck are computed against each round's
//   // predecessor.
//
// and src/doors/stop-rule.ts:321 (the module's P0 test):
//
//   const p0 = window.some((r) => r.some((b) => b.severity === "P0"))
//
// — the P0 check is scoped to the WINDOW, and the module's own header
// says so (src/doors/stop-rule.ts:8-11):
//
//   // eligible = rounds ≥ min_rounds (good faith), no P0 in the window,
//   //            novel ≤ novelMax for `rounds` consecutive rounds, and
//   //            no stuck bucket in the window.
//
// The cold twin (templates/pr-review/hooks/stop-rule.mjs:32) computes:
//
//   const p0 = curBlocked.some((b) => b.severity === "P0") ||
//              prior.some((r) => r.p0 === true)
//
// — `prior` is EVERY hand-down round (the door hands down the whole
// span: src/doors/review.ts:1088-1092), not the window's. So a P0
// from an OLD round — already fixed, already outside the window —
// keeps the twin's p0 true FOREVER.
//
// The twin's own header states the law it breaks
// (templates/pr-review/hooks/stop-rule.mjs:8-12):
//
//   // hooks/stop-rule.mjs — the cold twin of src/doors/stop-rule.ts.
//   // … the eligibility math must MATCH the module's (the writer≡reader
//   // law — pinned by test/stop-rule.test.ts's round-trip).
//
// and the repo's own test file states it too
// (test/stop-rule.test.ts:5-6):
//
//   //   5. writer≡reader: the door's STOP_HISTORY grammar ↔ the cold twin's
//   //      eligibility — two implementations, one answer
//
// The round-trip test (test/stop-rule.test.ts:110-152) only feeds the
// twin a history whose P0 sits INSIDE the window (its eligible case has
// no P0 at all; its stuck case has no P0) — so the divergence is
// untested.
//
// THE HARM: the banner is the ONLY place the fixer reads the criterion
// ("the loop's honest end is announced where the fixer reads", the
// change's own words at src/doors/stop-rule.ts:271-274). For a PR
// whose history ever carried a P0, the twin prints NOTHING — the
// honest end is never announced and the ratchet runs on. Meanwhile
// the ship door (bin/whitehartlane's `ship` arm, src/doors/ship.ts
// via stopEligibility) records the MODULE's answer in the ledger row
// and the PR comment — so the PR's own receipts contradict each other
// about the same question.
//
// The repro drives BOTH seats with the REAL hand-down grammar the
// door writes (review.ts: {buckets, p0}, oldest first, PRIOR rounds
// only) and asserts ONE answer.
//
// BASE behaviour: neither src/doors/stop-rule.ts nor
// templates/pr-review/hooks/stop-rule.mjs exists on BASE → the
// criterion does not exist at all; this feature is introduced by the
// diff.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")

test("the stop rule's two seats answer alike: a P0 outside the window does not veto the window", async () => {
  const stop = await import(join(HEAD, "src", "doors", "stop-rule.ts")).catch(() => null)
  if (!stop) return // BASE shape: the criterion does not exist — introduced by this diff

  const f = (id: string, file: string, line: number, severity = "P1") => ({
    id,
    severity,
    location: { file, line_start: line },
  })

  // THREE rounds: round 1 carried a P0 (already fixed, long outside the
  // 2-round window); rounds 2 and 3 are quiet. The window is the last
  // cfg.rounds rounds — the P0 is OUTSIDE it.
  const history = [[f("p0-1", "src/a.ts", 1, "P0")], [], []]
  const mine = stop.stopEligibility(history, stop.DEFAULT_STOP)

  // the door's hand-down grammar: {buckets, p0} per PRIOR round, oldest
  // first (src/doors/review.ts:1088-1092). The current round's
  // findings ride in the verdict the twin reads.
  const handDown = JSON.stringify(
    history.slice(0, -1).map((r) => ({ buckets: stop.clustersOf(r), p0: r.some((b) => b.severity === "P0") })),
  )

  const tmp = mkdtempSync(join(tmpdir(), "aos-q32-"))
  try {
    const verdictPath = join(tmp, "verdict.json")
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: history[history.length - 1] }))
    const twin = spawnSync(
      "node",
      [join(HEAD, "templates", "pr-review", "hooks", "stop-rule.mjs"), verdictPath, handDown, JSON.stringify(stop.DEFAULT_STOP)],
      { encoding: "utf8" },
    )
    assert.equal(twin.status, 0, `the twin must run (stderr: ${twin.stderr})`)
    const seat = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))

    assert.equal(
      seat.eligible,
      mine.eligible,
      `the module says ${mine.eligible} ("${mine.why}") and the cold twin says ${seat.eligible} — two seats, one question, two answers.\n` +
        `The module's P0 test is scoped to the window (src/doors/stop-rule.ts:321: \`window.some((r) => r.some((b) => b.severity === "P0"))\`); the twin's spans EVERY hand-down round (templates/pr-review/hooks/stop-rule.mjs:32: \`prior.some((r) => r.p0 === true)\`).\n` +
        `A P0 that is already fixed and already outside the window must not veto the window — the module's own header states that law (src/doors/stop-rule.ts:8-11), and the twin's header claims it matches the module (templates/pr-review/hooks/stop-rule.mjs:8-12).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
