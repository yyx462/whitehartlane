import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

// INV-2: the roster key the TOML parser accepts must reach the one
// external reader. `whl ship-config` calls shipConfigOf(repo) with no
// base/head (bin/whitehartlane ship-config). The commit path parses
// roster; this seat does not — the field vanishes.
test("momentum-1: shipConfigOf() with no commit surfaces a working-tree roster (INV-2)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mom-roster-"))
  try {
    writeFileSync(join(tmp, "review-gate.toml"), 'auto = true\nstrictness = "strict"\nroster = ["principles", "tests", "questions"]\n')
    const cfg = shipConfigOf(tmp)
    assert.deepEqual(
      cfg.roster,
      ["principles", "tests", "questions"],
      "INV-2: roster accepted by the contract parser must reach shipConfigOf() — the seat whl ship-config calls — not vanish",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
