import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one function per decision) / INV-4 (the suite's green is a
// verdict). "is this rebirthRunner refusal a successor-conflict (exit
// 2)?" is classified by the prose test `/successor booking/.test(
// reborn.why)` — and this diff introduced that classifier at TWO sites
// in bin/whitehartlane: the refresh verb (bin:765) and the continue
// verb (bin:861), each matching the free-text `why` that
// src/adapters/levy.ts:77 formats. Two copies of one classifier keyed
// on prose: rewording levy.ts's message (or a new refusal reason that
// happens to contain the phrase) silently reclassifies both verbs —
// the exit-2 contract the r24/r25 repros pin (momentum-12-r24,
// principles-22) then holds only while the sentence is never touched.
// One decision, two owners — the incomplete-fix/twin class this repo's
// own INVARIANTS name. The tree's own test/review/questions-8.test.ts
// already fails on HEAD for exactly this (making the suite command
// this diff widens — package.json's quoted glob — RED at HEAD,
// against tests-8's own law "npm test must be green over everything
// its own glob now includes"); this repro pins the twin directly so
// the finding survives independent of that file's provenance.
// On BASE neither site exists (grep count 0), so the assertion is
// green there — the twin is INTRODUCED by this change.
test("the successor-conflict exit-code classifier is decided in at most one place", () => {
  const bin = readFileSync(join(ROOT, "bin", "whitehartlane"), "utf8")
  const sites = [...bin.matchAll(/\/successor booking\/\.test\(/g)]
  assert.ok(
    sites.length <= 1,
    `INV-3 (one function per decision): "is this rebirthRunner refusal a successor-conflict (exit 2)?" is ` +
      `classified at ${sites.length} sites in bin/whitehartlane (the refresh verb at :765 and the continue ` +
      `verb at :861), each running /successor booking/.test(reborn.why) against the free-text why that ` +
      `src/adapters/levy.ts formats. The two copies must be edited in lockstep forever, and the exit-2 ` +
      `contract the r24/r25 repros pin (momentum-12-r24, principles-22) breaks the day the prose is reworded ` +
      `— test/review/questions-8.test.ts already fails on HEAD over this, leaving the widened \`npm test\` ` +
      `red with no named exclusion. Classify once — on the SpawnOutcome (a structured refusal kind from ` +
      `rebirthRunner) — and let both verbs read that one answer.`,
  )
})
