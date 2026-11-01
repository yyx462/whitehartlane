// principles-5202 — the stop rule's OWN two implementations answer the
// same question differently: the door's module says "eligible", the cold
// twin merge.sh calls says "not eligible", for the same history.
//
// The change adds the owner's stop rule in TWO places BY DESIGN (the
// cold-twin pattern): src/doors/stop-rule.ts (the door's module) and
// templates/pr-review/hooks/stop-rule.mjs (the cold twin merge.sh calls
// with the hand-down). The change's own law is explicit — the twin file
// states it at lines 29-33:
//
//   // ONE QUESTION, ONE ANSWER (the momentum-1001 receipt): the module
//   // scopes its P0 veto to the WINDOW (the last cfg.rounds rounds); the
//   // twin must too — an OR over every hand-down round let a P0 that is
//   // fixed and outside the window veto the banner forever while the
//   // door said eligible. Window = the current round + the last
//   // (cfg.rounds - 1) hand-down entries.
//   const p0 = curBlocked.some((b) => b.severity === "P0") || prior.slice(-(cfg.rounds - 1)).some((r) => r.p0 === true)
//
// `prior.slice(-(cfg.rounds - 1))` IS the off-by-one. With
// cfg.rounds === 1 the slice argument is `-0`, and in JS `slice(-0)` is
// `slice(0)` — the WHOLE hand-down array, not "the last 0 entries". So
// at rounds = 1 the twin's P0 veto spans every prior round, while the
// module's window (src/doors/stop-rule.ts:78,
// `history.slice(-cfg.rounds)`) is the current round alone.
//
// ROUNDS = 1 IS A REACHABLE OWNER VALUE: stopConfigOf's parser accepts
// any number >= 1 (src/doors/stop-rule.ts:107 — `typeof v === "number"
// && v >= 1 ? Math.floor(v) : d`), and the [stop] block rides the BASE
// commit's review-gate.toml, so a repo whose base declares
// `rounds = 1` gets it.
//
// THE HARM — the two halves of one feature disagree, and each is
// load-bearing:
//   * the door's module (src/doors/stop-rule.ts + bin/whitehartlane's
//     `ship` verb) records the fact beside every override — the ledger
//     row's `stop:` field and the PR comment say "eligible";
//   * the twin (templates/pr-review/hooks/stop-rule.mjs, called from
//     merge.sh's reject arm) prints the banner the FIXER reads — "the
//     gate declares diminishing returns ... the owner may end this
//     review".
//
// So the owner is told, in the ledger and on the PR, that the loop's
// honest end has arrived, while the banner that announces it where the
// fixer reads never fires — and the door's own comment on the twin
// names this exact failure as the thing it was fixing ("a P0 that is
// fixed and outside the window veto the banner forever while the door
// said eligible"). The fix reproduces the very bug it cites.
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

test("principles-5202: the stop rule's module and its cold twin must answer the same question alike", async () => {
  if (!existsSync(MODULE) || !existsSync(TWIN)) return // BASE: the stop rule does not exist yet
  const { stopEligibility, clustersOf } = await import(MODULE)
  const tmp = mkdtempSync(join(tmpdir(), "aos-p5202-"))
  try {
    // round 1: a P0 that was FIXED (it does not recur)
    const round1 = [{ id: "a-1", severity: "P0", location: { file: "src/doors/ship.ts", line_start: 10 } }]
    // round 2 (the current round): a different root cause, no P0
    const round2 = [{ id: "b-1", severity: "P1", location: { file: "src/doors/run.ts", line_start: 5 } }]
    // rounds = 1 — a value stopConfigOf ACCEPTS (src/doors/stop-rule.ts:107)
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
        `The twin's P0 veto is prior.slice(-(cfg.rounds - 1)).some(r => r.p0 === true) (templates/pr-review/hooks/stop-rule.mjs:33) — with cfg.rounds = 1 the slice argument is -0, and slice(-0) is slice(0): the WHOLE hand-down array. So a P0 that is already fixed, in a round OUTSIDE the window, vetoes the banner forever while the door says eligible — the very failure the twin's own comment says it fixed.\n` +
        `The module's window is history.slice(-cfg.rounds) (src/doors/stop-rule.ts:78) — the current round alone at rounds = 1.\n` +
        `rounds = 1 is a reachable owner value: stopConfigOf accepts any number >= 1 (src/doors/stop-rule.ts:107) and the [stop] block rides the BASE commit.\n` +
        `cfg=${JSON.stringify(cfg)} history=[${JSON.stringify(round1)}, ${JSON.stringify(round2)}]`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
