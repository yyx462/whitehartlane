// questions-2-twin (questions lens, Q2 — one decision, one owner) —
// THE COLD TWIN AND THE MODULE ANSWER THE SAME QUESTION DIFFERENTLY
// WHEN THE OWNER'S [stop] rounds = 1.
//
// The change adds the owner's stop rule in TWO places (by design, the
// cold-twin pattern): src/doors/stop-rule.ts (the door's module) and
// templates/pr-review/hooks/stop-rule.mjs (the cold twin merge.sh
// calls). The change's own law is explicit:
//
//   templates/pr-review/hooks/stop-rule.mjs:29-33
//   // ONE QUESTION, ONE ANSWER (the momentum-1001 receipt): the module
//   // scopes its P0 veto to the WINDOW (the last cfg.rounds rounds); the
//   // twin must too — an OR over every hand-down round let a P0 that is
//   // fixed and outside the window veto the banner forever while the
//   // door said eligible. Window = the current round + the last
//   // (cfg.rounds - 1) hand-down entries.
//   const p0 = curBlocked.some((b) => b.severity === "P0") || prior.slice(-(cfg.rounds - 1)).some((r) => r.p0 === true)
//
// `prior.slice(-(cfg.rounds - 1))` is the off-by-one: with
// cfg.rounds === 1 the slice argument is `-0`, and in JS `slice(-0)` is
// `slice(0)` — the WHOLE hand-down array, not "the last 0 entries".
// So at rounds = 1 the twin's P0 veto spans EVERY prior round, while
// the module's window (src/doors/stop-rule.ts:96, `history.slice(-cfg.rounds)`)
// is the current round alone.
//
// rounds = 1 is a REACHABLE owner value: stopConfigOf's parser accepts
// any number >= 1 (`typeof v === "number" && v >= 1 ? Math.floor(v) : d`,
// src/doors/stop-rule.ts:107) and the [stop] block rides the BASE
// commit (review-gate.toml's `rounds = 2` is only this repo's default).
//
// THE HARM: the two answers are the two halves of one feature. The
// module's answer is the fact the ship door records beside an
// override (src/doors/stop-rule.ts + bin/whitehartlane's `ship`
// verb); the twin's answer is the banner merge.sh prints on the
// reject path — "the loop's honest end is announced where the fixer
// reads, not left to owner folklore" (merge.sh:153-157). At rounds = 1
// the twin never announces the end: a P0 that was FIXED in an earlier
// round keeps vetoing the banner forever, while the door says
// "eligible". That is exactly the failure the twin's own comment says
// it fixed.
//
// The change's own test (test/stop-rule.test.ts, "writer≡reader: the
// door's STOP_HISTORY grammar and the cold twin's eligibility agree")
// only exercises the DEFAULT cfg (rounds = 2), so the divergence is
// invisible to it.
//
// BASE shape: neither file exists there (the stop rule is new in this
// change) — the guarded import makes this vacuous on BASE, which is
// the change's own convention (test/review/tests-702.test.ts:16-18).
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const MODULE = join(HEAD, "src", "doors", "stop-rule.ts")
const TWIN = join(HEAD, "templates", "pr-review", "hooks", "stop-rule.mjs")

test("the cold twin and the module answer the stop rule the same way at rounds = 1", async () => {
  if (!existsSync(MODULE) || !existsSync(TWIN)) return // BASE: the stop rule does not exist yet
  const { stopEligibility, clustersOf } = await import(MODULE)
  const tmp = mkdtempSync(join(tmpdir(), "aos-q2-twin-"))
  try {
    // round 1: a P0 that was FIXED (it does not recur)
    const round1 = [{ id: "a-1", severity: "P0", location: { file: "src/doors/ship.ts", line_start: 10 } }]
    // round 2 (the current round): a different root cause, no P0
    const round2 = [{ id: "b-1", severity: "P1", location: { file: "src/doors/run.ts", line_start: 5 } }]
    const cfg = { rounds: 1, novelMax: 1, minRounds: 2 }

    // the door's module — the whole history, oldest first
    const mine = stopEligibility([round1, round2], cfg)

    // the cold twin — the door's hand-down (prior rounds) + the current round
    const prior = [{ buckets: clustersOf(round1), p0: true }]
    const verdictPath = join(tmp, "verdict.json")
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: round2 }))
    execFileSync("node", [TWIN, verdictPath, JSON.stringify(prior), JSON.stringify(cfg)], { encoding: "utf8" })
    const seat = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))

    assert.equal(
      seat.eligible,
      mine.eligible,
      `the twin and the module must answer the same question the same way (the change's own writer≡reader law) — the module says eligible=${mine.eligible} ("${mine.why}"), the twin says eligible=${seat.eligible}.\n` +
        `The twin's P0 veto is prior.slice(-(cfg.rounds - 1)).some(r => r.p0 === true) (templates/pr-review/hooks/stop-rule.mjs:33) — with cfg.rounds = 1 the slice argument is -0, and slice(-0) is slice(0): the WHOLE hand-down array. So a P0 that is already fixed, in a round OUTSIDE the window, vetoes the banner forever while the door says eligible.\n` +
        `cfg=${JSON.stringify(cfg)} history=[${JSON.stringify(round1)}, ${JSON.stringify(round2)}]`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
