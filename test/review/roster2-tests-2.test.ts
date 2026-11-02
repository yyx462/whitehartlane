// duplicate entries inflate universe.length to LENSES.length, so the
// "absent means all four" mark fires while momentum is dropped.
import assert from "node:assert/strict"
import test from "node:test"
import { BANDS, decideGate, type GateFeatures } from "../../src/doors/review-gate.ts"

const STATS0 = { greens: 0, reds: 0, audits: 0, rate: 1.0 }
const features = (): GateFeatures => ({
  repo: "/tmp/r",
  base: "master",
  head: "feat",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  files: ["src/a.ts"],
  churn: 40,
  klass: "code_small",
  hotFiles: [],
})

test("duplicate-inflated universe must not hide the cap (INV-4)", () => {
  const universe = ["principles", "tests", "questions", "principles"] as const
  const d = decideGate(
    features(),
    { principles: 0.9, tests: 0.9, momentum: 0.99, questions: 0.9 },
    STATS0,
    0.5,
    BANDS.medium,
    universe,
  )
  assert.ok(
    d.universe !== undefined || d.roster.includes("momentum"),
    `INV-4: a ceiling that is not all four must be recorded, or the roster must be all four. absent universe means all four, but roster=${JSON.stringify(d.roster)} dropped momentum while universe=${JSON.stringify(d.universe)}`,
  )
  assert.equal(new Set(d.roster).size, d.roster.length, `INV-3: roster must be deduped; got ${JSON.stringify(d.roster)}`)
})
