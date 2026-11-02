// INV-2: a roster value the toml parser accepts must reach a consumer —
// refuse, never vanish. A boolean/number is not an array and not the csv
// string spelling; parseRosterKey returns {} for it, identical to no key.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

test("INV-2: a non-string non-array roster must be surfaced, not vanished", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tests-2-bool-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, "review-gate.toml"), "roster = true\n")
    const cfg = shipConfigOf(repo)
    assert.ok(
      (cfg.rosterUnknown && cfg.rosterUnknown.length > 0) || cfg.roster !== undefined,
      `INV-2: roster = true is accepted by the toml parser then dropped — roster=${JSON.stringify(cfg.roster)} rosterUnknown=${JSON.stringify(cfg.rosterUnknown)}, indistinguishable from no contract, so the door's loud refusal never fires`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
