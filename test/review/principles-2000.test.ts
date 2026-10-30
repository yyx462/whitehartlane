// principles-2000 — INV-3 (one function per decision), the tier-2 twin.
//
// DECISION: "which opencode session in this directory does the wake
// go to". The repo's one owner is src/adapters/transcripts.ts
// (resolveOpencode): its CLI fallback NEVER trusts the list order —
// it scans max(created) over every entry (transcripts.ts:206-212),
// because CLI order is not a contract; its db path does its own
// ORDER BY time_created DESC rather than trusting the caller.
//
// ship-supervisor.ts resolveCaller is a SECOND site for the same
// decision (its own comment: "binding then GUESSES the
// commissioner") and it binds `matching[0]` on the assumption the
// CLI returns newest-first (ship-supervisor.ts:128). The same
// machine state, two CLI orders → two different wake targets: the
// wake address is a coin flip on list order, and a wrong-owner wake
// is the exact violation the module's own comment says is "worse
// than minting a supervisor".
//
// BASE: ship-supervisor.ts does not exist there — vacuous pass (the
// repo's own convention, cf. test/review/tests-702.test.ts).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MOD_URL = new URL("../../src/doors/ship-supervisor.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? (await import(MOD_URL)) as typeof import("../../src/doors/ship-supervisor.ts") : undefined

const stubBin = (dir: string, name: string, out: string): string => {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(p, 0o755)
  return p
}

test("resolveCaller tier-2: the wake target is a function of the session SET, never of CLI list order (INV-3 twin of transcripts.ts resolveOpencode)", async (t) => {
  if (!mod) return t.skip("BASE shape: no ship-supervisor module — nothing to judge")
  const tmp = mkdtempSync(join(tmpdir(), "aos-p2000-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(repo)
    const herdr = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "opencode" } } }))
    const now = 1793339266367
    // the j-eafc83 sibling shape: two sessions, ONE directory, both
    // quiet past the code's own 10-minute window — exactly the state
    // where the twin owner (transcripts.ts:189-194) REFUSES to guess
    const set = [
      { id: "ses_a", directory: repo, updated: now - 30 * 60 * 1000 },
      { id: "ses_b", directory: repo, updated: now - 31 * 60 * 1000 },
    ]
    // the SAME session set in both orders: the repo's own CLI-list
    // reader (listOpencodeSessions + max(created), transcripts.ts:206-212)
    // answers identically for both; a newest-first ASSUMPTION does not
    const forward = stubBin(tmp, "oc-fwd", JSON.stringify(set))
    const reversed = stubBin(tmp, "oc-rev", JSON.stringify([set[1]!, set[0]!]))
    const env = (oc: string) => ({ HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: oc })
    const a = mod.resolveCaller(repo, { env: env(forward), now })
    const b = mod.resolveCaller(repo, { env: env(reversed), now })
    // ADOPTED WITH THE FIX (momentum-1, round 5 — identity by
    // uniqueness, never recency or order): two candidates in the
    // project is a GUESS, and a guessed wake owner is the wrong-owner
    // wake. Both orders must REFUSE — order-independence by refusing
    // to guess at all, the stronger shape.
    assert.equal(a, null, "sanity under the uniqueness law: two sessions in the project → the forward order refuses")
    assert.equal(b, null, "the reversed order refuses identically — never a guess")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
