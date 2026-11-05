// momentum-1 — the ceiling field's own contract ("absent = all four") is
// broken on the docs-only arm. Every other decideGate return spreads
// `capped` when universe.length < LENSES.length. The docs_only return
// (src/doors/review-gate.ts, the early return before `capped` is used)
// omits it, so a project that declared a three-lens ceiling writes a
// decision whose missing `universe` means "all four by definition".
//
// BASE has no universe parameter: the feature is absent, the assertion
// is vacuous, the test passes. HEAD has the field and forgets it on
// this one arm.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { BANDS, decideGate, gateReceipt, type GateFeatures } from "../../src/doors/review-gate.ts"

const ROOT = resolve(import.meta.dirname, "..", "..")
const CEILING = ["principles", "tests"] as const

const docs: GateFeatures = {
  repo: "/tmp/r",
  base: "master",
  head: "feat",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  files: ["README.md"],
  churn: 4,
  klass: "docs_only",
  hotFiles: [],
}

test("momentum-1: a capped docs-only decision records the ceiling (absent means all four) (INV-4)", () => {
  const src = readFileSync(resolve(ROOT, "src/doors/review-gate.ts"), "utf8")
  if (!src.includes("universe: readonly Lens[]")) return

  const d = decideGate(docs, null, { greens: 0, reds: 0, audits: 0, rate: 1 }, 0.99, BANDS.medium, CEILING)
  assert.deepEqual(
    d.universe,
    [...CEILING],
    "INV-4: docs-only skip omitted universe — absent means all four, but the project ceiling is principles,tests",
  )
  assert.match(
    gateReceipt(docs, d),
    /universe: principles,tests/,
    "INV-4: the docs-only receipt must name the ceiling; a missing universe reads as all four",
  )
})
