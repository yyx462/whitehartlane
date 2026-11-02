// principles-5101 — the stop rule's OWN two implementations answer the
// same question differently: the module (src/doors/stop-rule.ts) and
// the cold twin (templates/pr-review/hooks/stop-rule.mjs) disagree
// about whether a P0 OUTSIDE the eligibility window disqualifies.
//
// The change's own law (test/stop-rule.test.ts:5, "writer≡reader: the
// door's STOP_HISTORY grammar ↔ the cold twin's eligibility — two
// implementations, one answer") claims ONE answer. There are two.
//
// The module (src/doors/stop-rule.ts:70):
//     const p0 = window.some((r) => r.some((b) => b.severity === "P0"))
// — the P0 check is scoped to the WINDOW (the last cfg.rounds rounds).
// A P0 in an OLDER round does NOT disqualify.
//
// The twin (templates/pr-review/hooks/stop-rule.mjs:33):
//     const p0 = curBlocked.some((b) => b.severity === "P0")
//                 || prior.some((r) => r.p0 === true)
// — the twin ORs the p0 flag over ALL prior rounds, window or not. A
// P0 in an OLDER round DOES disqualify.
//
// The two consumers are exactly the two sites that must agree:
//   src/doors/stop-rule.ts        → bin/whitehartlane's `ship` verb
//                                    (the ledger row's stop: fact and
//                                    the PR comment's "The gate's stop
//                                    rule at merge time: ...")
//   templates/.../stop-rule.mjs   → merge.sh's reject arm (the banner
//                                    the fixer reads)
// The banner says "diminishing returns — the owner may end this
// review"; the ledger says the opposite. One question, two answers.
//
// The repro drives the repo's OWN two implementations on the SAME
// history — the module's stopEligibility and the twin's stop-rule.mjs
// — with the hand-down grammar review.ts:1139-1145 writes.
//
// BASE behaviour: BASE has neither src/doors/stop-rule.ts nor
// templates/pr-review/hooks/stop-rule.mjs (both are new in this
// change), so the test SKIPS on BASE and the finding is introduced.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MODULE = join(import.meta.dirname, "..", "..", "src", "doors", "stop-rule.ts")
const TWIN = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "stop-rule.mjs")

const f = (id: string, file: string, line: number, severity = "P1") => ({
  id,
  severity,
  location: { file, line_start: line },
})

test("principles-5101: the stop rule's module and its cold twin must give one answer", async () => {
  if (!existsSync(MODULE) || !existsSync(TWIN)) return // BASE shape: neither exists yet

  const mod = await import(MODULE)
  const { stopEligibility, clustersOf, DEFAULT_STOP } = mod

  // the history: round 1 carried a P0; rounds 2 and 3 are quiet.
  // The P0 sits OUTSIDE the 2-round eligibility window.
  const history = [
    [f("p0-1", "src/a.ts", 1, "P0")],
    [f("q-2", "src/b.ts", 1)],
    [],
  ]

  // the module's answer (the door's owner — bin's ship verb)
  const mine = stopEligibility(history, DEFAULT_STOP)

  // the twin's answer (merge.sh's cold copy), fed the SAME history in
  // the hand-down grammar review.ts:1141-1145 writes
  const tmp = mkdtempSync(join(tmpdir(), "p5101-twin-"))
  try {
    const verdictPath = join(tmp, "verdict.json")
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: history[history.length - 1] }))
    const handDown = JSON.stringify(
      history.slice(0, -1).map((r) => ({ buckets: clustersOf(r), p0: r.some((b) => b.severity === "P0") })),
    )
    execFileSync("node", [TWIN, verdictPath, handDown, JSON.stringify(DEFAULT_STOP)], { encoding: "utf8" })
    const seat = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))

    assert.equal(
      seat.eligible,
      mine.eligible,
      `the stop rule has ONE decision ("is the loop at its honest end?") and TWO implementations that disagree: the module (src/doors/stop-rule.ts:70) scopes the P0 check to the window, the cold twin (templates/pr-review/hooks/stop-rule.mjs:33) ORs the p0 flag over ALL prior rounds. A P0 in an older round makes the module say eligible=${mine.eligible} while the twin says eligible=${seat.eligible} — the banner merge.sh prints and the ledger fact bin's ship verb records then contradict each other`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
