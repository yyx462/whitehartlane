// tests-5 — the cheapest-first ruling was applied to the static ladder and
// LEFT WRONG in the judge's own prompt (the twin site of "which model
// now").
//
// What the diff claims (src/jev/model-chooser.ts, the file's own header):
//   "CHEAPEST FIRST (the owner's ruling, 2026-10-30): the reviewers burned
//    the coding plan on every review because the paid model sat at the
//    head of the zero-config order. The flash rung on minimax.cn is the
//    default seat; the paid rungs are escalation, not the plan."
//   and in the CATALOG it moved:
//     "zhipuai-coding-plan/glm-5.3": { cost: "... (the escalation rung)" }
//   (the GLM rung's cost text now says "the escalation rung" — it used to
//   say "the preferred workhorse").
//
// The twin site, twenty lines below, still says the opposite
// (src/jev/model-chooser.ts, chooserQuestions):
//   "The operator holds a GLM coding plan, so GLM candidates are
//    plan-covered and strongly preferred: prefer a live GLM candidate over
//    grok-4.7 whenever it can carry the work. Otherwise pick the cheapest
//    candidate that can still carry the work to completion, and escalate
//    to grok-4.7 only when no GLM candidate is live..."
//
// The judge is not a bystander: it is the decider on two live paths —
//   - src/engines/coworker-run.ts: "No explicit member model + a
//     configured chooser = the judge picks" (the BIRTH model), and
//   - src/engines/fault-lane.ts: on a provider fault, "the chooser (or
//     the static ladder…) picks among what is left".
// The static ladder (DEFAULT_ORDER = the CATALOG's key order) IS
// cheapest-first after this diff; the judge OVERRIDES it, and its prompt
// still ranks the paid GLM plan first. So the ruling holds on the
// fallback path and is inverted on the deciding one.
//
// The diff's own test file even advertises the new policy in its title —
// "with real rates and the cheapest-first policy" — while its body pins
// the OLD wording ("GLM coding plan", "strongly preferred"): a renamed
// test that describes a policy it does not assert.
//
// The repro reads the chooser's own prompt — the prompt the judge reads.
//
// BASE behaviour: the CATALOG's order differs, but the prompt is the
// same, so this test fails on BASE too; the diff touches
// src/jev/model-chooser.ts, so the finding classifies as
// incomplete-fix.
import assert from "node:assert/strict"
import test from "node:test"
import { CATALOG, chooserQuestions } from "../../src/jev/model-chooser.ts"

const CANDIDATES = [
  "minimax-cn/MiniMax-M3.1-Flash",
  "zhipuai-coding-plan/glm-5.3-flash",
  "zhipuai-coding-plan/glm-5.3",
  "xai/grok-4.7",
]

test("tests-5: the judge's prompt must rank the cheapest rung first", () => {
  const q = chooserQuestions(CANDIDATES) as { pick: { instructions: string; criteria: Record<string, string> } }
  const instructions = q.pick.instructions
  // the catalog's ladder is cheapest-first after this diff
  assert.equal(
    CATALOG["minimax-cn/MiniMax-M3.1-Flash"] !== undefined,
    true,
    "the cheap rung is in the catalog",
  )
  assert.match(
    CATALOG["zhipuai-coding-plan/glm-5.3"].cost,
    /escalation rung/,
    "the paid GLM rung is declared the escalation rung in the catalog",
  )
  // …and the judge that DECIDES must not be told to prefer the paid rung
  assert.doesNotMatch(
    instructions,
    /GLM candidates are plan-covered and strongly preferred/,
    `the judge's prompt still prefers the PAID GLM plan over the cheap rung — the cheapest-first ruling was applied to the static ladder and left wrong in the prompt that actually picks the model.\ninstructions: ${instructions}`,
  )
  assert.doesNotMatch(
    instructions,
    /strongly preferred/,
    `no rung may be "strongly preferred" under the cheapest-first ruling (the cheap rung is the default seat; the paid rungs are escalation).\ninstructions: ${instructions}`,
  )
})
