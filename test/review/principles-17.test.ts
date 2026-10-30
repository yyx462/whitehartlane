// principles-17 (repro for finding principles-2, P1) — the supervisor
// brief's spelled wait has NO deadline, so it cannot end on the arc the
// brief ITSELF enumerates. Step 2 prescribes the literal loop
//   until [ -f "$V" ]; do sleep 15; done; cat "$V"
// and step 4 handles "If verdict.json is ABSENT (no verdict — the inner
// door refused, or infra failed)". But when no verdict ever lands, the
// spelled loop never exits: the agent's ENTIRE commission is that
// foreground blocking loop, so step 4's comment and step 7's "if the
// wait exceeds 2 hours" are prose the blocked process can never reach.
// The inner door refusing (docs-flip, empty-diff flip, refused model,
// roster ∩ template = ∅, whl not on the supervisor's PATH) is a normal
// reachable outcome — and on every one of them the PR is silent
// FOREVER while the mint already exited 0 printing "verdict: will land
// at … and as a comment on the PR". One wake per commission requires a
// hearer that can FINISH; the first supervisor receipt (died by exiting
// early, PR #259 silent) was cured by prescribing the opposite: a wait
// that cannot end at all.
//
// BASE shape: no ship-supervisor module there — vacuous pass (the
// repo's own convention, cf. test/review/momentum-2-r26.test.ts).
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import test from "node:test"

const MOD_URL = new URL("../../src/doors/ship-supervisor.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? await import(MOD_URL) : undefined

test("principles-17: the supervisor's spelled wait must carry its own deadline — a hearer that cannot finish leaves the PR silent forever (one wake per commission)", () => {
  if (!mod) return // BASE: no ship-supervisor — nothing to judge
  const { supervisorBrief } = mod as typeof import("../../src/doors/ship-supervisor.ts")

  const brief = supervisorBrief({
    levyCmd: "whl review '/repo' --base 'b' --head 'h' --model 'acme/strong' --roster 'principles,tests,momentum,questions' --unattended",
    runDir: "/run/pr7",
    pr: "7",
    repo: "/repo",
  })

  // the step-2 instruction, in full (the wait's whole spelling)
  const step2 = brief.split("\n").find((l) => l.startsWith("2. STAY ALIVE"))
  assert.ok(step2, "the brief states its wait instruction (step 2)")
  assert.match(step2, /until \[ -f "\$V" \]/, "the spelled poll watches the verdict file (observed state — good)")
  // the invariant: the wait must be able to END when the file never
  // appears. A deadline INSIDE the spelled wait (a $SECONDS bound, a
  // `timeout` wrapper, a counted-iterations max) is the only thing that
  // lets a blocked one-shot process ever reach step 4 (post the
  // outcome) or step 7 (the 2-hour timeout comment). Today the only
  // "2 hours" in the commission lives in a LATER step the loop can
  // never return to.
  assert.match(
    step2,
    /SECONDS|deadline|timeout|-t |7200/,
    "INV: the hearer's wait must be bounded by its own spell — 'until [ -f \"$V\" ]; do sleep 15; done' has no deadline, so on the brief's own 'verdict.json is ABSENT' arc (inner door refused / infra failed) the supervisor blocks forever: step 4's outcome comment and step 7's 2h timeout are unreachable prose, and the PR is left silent for good while the mint already promised the verdict would reach it",
  )
})
