import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one function per decision): "is this rebirthRunner refusal a
// successor-conflict?" is decided TWICE in bin/whitehartlane — the
// refresh verb (bin:765) and the continue verb (bin:861) each run
// `/successor booking/.test(reborn.why)` against the free-text `why`
// that src/adapters/levy.ts:77 formats. Two copies of one classifier,
// keyed on prose: any rewording of levy.ts's message (or a new refusal
// reason that happens to contain the phrase) silently reclassifies both
// verbs to exit 1 — the exit-2 contract the r24/r25 repros pin
// (momentum-12-r24, principles-22) then holds only while the sentence
// is never touched. One decision, one owner: the outcome should be
// classified once (on the SpawnOutcome), and both verbs read that.
test("the successor-conflict exit-code classification lives in exactly one place", () => {
  const bin = readFileSync(join(ROOT, "bin", "whitehartlane"), "utf8")
  const hits = [...bin.matchAll(/successor booking/.source !== "" ? /\/successor booking\/\.test\(/g : /x/g)].length
  assert.ok(
    hits <= 1,
    `INV-3 (one function per decision): "is this rebirth refusal a successor-conflict (exit 2)?" is decided ` +
      `${hits} times in bin/whitehartlane (the refresh verb at :765 and the continue verb at :861), each site ` +
      `running /successor booking/.test(reborn.why) against the free-text why that src/adapters/levy.ts:77 ` +
      `formats. The two copies must be edited in lockstep forever, and the exit-2 contract the r24/r25 repros ` +
      `pin breaks the day the prose is reworded. Classify once — on the SpawnOutcome (a structured refusal ` +
      `kind from rebirthRunner) — and let both verbs read that one answer.`,
  )
})
