// momentum-1001 — the stop rule's TWO seats disagree: the module says
// "eligible", the cold twin says "not eligible" for the SAME history.
//
// src/doors/stop-rule.ts (the door's seat) computes:
//
//   const p0 = window.some((r) => r.some((b) => b.severity === "P0"))
//
// — the P0 check is scoped to the WINDOW (the last cfg.rounds rounds),
// and the module's own header says so:
//
//   // eligible = rounds ≥ min_rounds (good faith), no P0 in the window,
//   //            novel ≤ novelMax for `rounds` consecutive rounds, and
//   //            no stuck bucket in the window.
//
// templates/pr-review/hooks/stop-rule.mjs (the cold twin) computes:
//
//   const p0 = curBlocked.some((b) => b.severity === "P0") || prior.some((r) => r.p0 === true)
//
// — `prior` is EVERY hand-down round, not the window's. So a P0 from an
// OLD round (already fixed, already outside the window) keeps the twin's
// p0 true FOREVER, and the twin refuses eligibility for the rest of the
// PR's life.
//
// The twin's own header claims the math must match:
//
//   // hooks/stop-rule.mjs — the cold twin of src/doors/stop-rule.ts.
//   // … the eligibility math must MATCH the module's (the writer≡reader
//   // law — pinned by test/stop-rule.test.ts's round-trip).
//
// and the repo's own test file states the law it believes:
//
//   // 5. writer≡reader: the door's STOP_HISTORY grammar ↔ the cold twin's
//   //    eligibility — two implementations, one answer
//
// THE HARM (the momentum law this whole feature exists for): the banner
// is the ONLY place the fixer reads the criterion ("the loop's honest end
// is announced where the fixer reads, not left to owner folklore"). For a
// PR whose history ever carried a P0, the twin prints NOTHING — the
// honest end is never announced, and the ratchet runs on ("zero findings
// in a growing diff is not a reachable termination condition"). Meanwhile
// the ship door (bin/whitehartlane's `ship` arm) records the MODULE's
// fact in the ledger row and the PR comment ("eligible — novel 0 ≤ 1 …"),
// so the PR's own receipts contradict each other about the same question.
//
// The repro drives both seats with the REAL hand-down grammar the door
// writes (review.ts: {buckets, p0}, oldest first, PRIOR rounds only) and
// asserts ONE answer.
//
// BASE behaviour: neither src/doors/stop-rule.ts nor
// templates/pr-review/hooks/stop-rule.mjs exists on BASE → the test
// passes there (the feature is introduced by this diff).
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const TWIN = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "stop-rule.mjs")

test("the stop rule's two seats answer alike: a P0 outside the window does not veto the window", async () => {
  const mod = await import("../../src/doors/stop-rule.ts").catch(() => null)
  if (!mod || !existsSync(TWIN)) return // BASE shape: the stop rule does not exist there
  const { stopEligibility, clustersOf, DEFAULT_STOP } = mod
  const f = (id: string, file: string, line: number, severity = "P1") => ({
    id,
    severity,
    location: { file, line_start: line },
  })

  // three rounds: r1 carried a P0 (since fixed), r2 and r3 are clean
  const r1 = [f("p0-1", "src/doors/a.ts", 5, "P0")]
  const r2: unknown[] = []
  const r3: unknown[] = []
  const module = stopEligibility([r1, r2, r3] as never, DEFAULT_STOP)

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1001-"))
  try {
    const verdictPath = join(tmp, "verdict.json")
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: r3 }))
    // the door's writer (review.ts): the PRIOR rounds, {buckets, p0}
    const handDown = JSON.stringify(
      [r1, r2].map((r) => ({
        buckets: clustersOf(r as never),
        p0: (r as Array<{ severity: string }>).some((b) => b.severity === "P0"),
      })),
    )
    const twin = spawnSync("node", [TWIN, verdictPath, handDown, JSON.stringify(DEFAULT_STOP)], { encoding: "utf8" })
    assert.equal(twin.status, 0, twin.stderr)
    const seat = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))
    assert.equal(
      seat.eligible,
      module.eligible,
      `the module says ${module.eligible} ("${module.why}") and the cold twin says ${seat.eligible} — two seats, one question, two answers (the twin's p0 spans EVERY hand-down round, the module's spans the window)`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
