// momentum-2005 — the chooser's prompt states a PRICE ORDER the candidate
// list it is handed does not have.
//
// THE CHANGE (src/jev/model-chooser.ts, the cheapest-first ruling of
// 2026-10-30): the CATALOG's key order became cheapest-first (the flash rung
// on minimax.cn first) and the judge's PROMPT was rewritten to match:
//
//   "The ladder is CHEAPEST FIRST: the candidates are listed from cheapest to
//    priciest — pick the cheapest one that can carry the work to completion."
//
// The prompt's own comment says why (src/jev/model-chooser.ts:99-103):
// "the judge reads the ladder in the order the catalog declares it, so the
// prompt must say the same thing the catalog says".
//
// BUT the judge is never handed the catalog's order. It is handed
// `opts.remaining` = the ORDER LAYER (src/jev/model-ladder.ts:149-160):
//   1. the run's models.json (the in-flight override),
//   2. the spur's workflow.toml [fallback] order,
//   3. the operator's models.local.toml order,
//   4. only then the built-in DEFAULT_ORDER (= the catalog's key order),
//
// and both deciders pass that order straight into chooserQuestions
// (src/engines/coworker-run.ts:212-217 — the BIRTH model,
// src/engines/fault-lane.ts:83-91 — the fault-lane pick).
//
// So on any program (or operator) whose configured order is not
// price-ascending, the prompt hands the judge a FALSE FACT about the very
// list it is choosing from ("listed from cheapest to priciest"), and the
// cheapest-first ruling the change claims to enforce is INVERTED on the
// deciding path.
//
// The BASE catalog's own order was exactly this shape: glm-5.3 ($1.40),
// glm-5.3-flash ($0.15), grok ($2.00) — so the shape is the ordinary one,
// not an exotic corner.
//
// INV-4: verdicts are honest. The judge is told a false fact about the list
// it picks from, and the change's own comment asserts a mechanism (the
// catalog's order) that does not reach the judge.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { CATALOG, chooserQuestions, remainingCandidates } from "../../src/jev/model-chooser.ts"
import { readModelsFile } from "../../src/jev/model-ladder.ts"

// the catalog's own price, in $/1M input tokens. The minimax rung declares
// no number ("pricing per minimax's current plan") and the catalog puts it
// FIRST ("the cheap rung ... the default seat"), so it is the cheapest.
const priceOf = (id: string): number => {
  const m = /^\$([\d.]+)/.exec(CATALOG[id]?.cost ?? "")
  return m ? Number(m[1]) : 0
}
const ascending = (ids: string[]): boolean => ids.every((id, i) => i === 0 || priceOf(ids[i - 1]) <= priceOf(id))

test("momentum-2005: the chooser's prompt must not state a price order the candidate list does not have", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2005-"))
  try {
    // a program whose configured ladder puts the paid rung first (the BASE
    // catalog's own order shape) — reachable through the spur's [fallback]
    // order, the operator's models.local.toml, or the run's models.json
    const toml = `[fallback]\nmode = "auto"\nchooser = "jev"\norder = ["xai/grok-4.7", "zhipuai-coding-plan/glm-5.3-flash"]\n`
    const policy = readModelsFile(tmp, toml, null)
    const remaining = remainingCandidates(policy.order, new Set())
    assert.ok(remaining.length > 0, "the policy must name candidates")
    assert.ok(!ascending(remaining), `the fixture must be a non-price-ascending ladder (got ${remaining.join(", ")})`)

    const q = chooserQuestions(remaining) as { pick: { instructions: string } }
    const instructions = q.pick.instructions
    assert.ok(
      !/listed from cheapest to priciest/.test(instructions),
      `the prompt tells the judge the candidates "are listed from cheapest to priciest", but the list the judge is handed (${remaining.join(", ")}) is NOT price-ascending (${remaining.map((r) => `${r}=$${priceOf(r)}`).join(", ")}) — the order comes from the policy layers (model-ladder.ts:149-160), not from the catalog. The judge is told a false fact about the very list it picks from, and the cheapest-first ruling the change claims to enforce is inverted on the deciding path.\ninstructions: ${instructions}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
