// A caller pin with one bad id must not shrink the universe to the
// file's narrower ceiling. parseRosterKey voids a typo (no roster);
// runGate then does `pin ?? cfg.roster ?? LENSES`, so the void falls
// through to the file and a typo shrinks the review.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LENSES, runGate } from "../../src/doors/review-gate.ts"

test("INV-2: a typo in the caller pin voids to all four, never the file's narrower ceiling", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests-2-pin-typo-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  writeFileSync(join(repo, "review-gate.toml"), 'strictness = "strict"\nroster = ["principles"]\n')
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
  const prev = process.env.WHL_GATE_LEDGER
  process.env.WHL_GATE_LEDGER = join(tmp, "ledger.jsonl")
  try {
    const { decision } = runGate(repo, "main", "feat", {
      jev: false,
      roster: ["principles", "tests", "bogus"] as never,
    })
    assert.deepEqual(
      decision.roster,
      [...LENSES],
      `INV-2: a typo must never shrink the universe — pin ["principles","tests","bogus"] over a file ceiling of [principles] ran ${JSON.stringify(decision.roster)} (universe ${JSON.stringify(decision.universe)})`,
    )
  } finally {
    if (prev === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prev
    rmSync(tmp, { recursive: true, force: true })
  }
})
