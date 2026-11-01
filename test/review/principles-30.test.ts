import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadManifest } from "../../src/doors/hooks.ts"

// INV-2 (an accepted field reaches its consumer — refuse, never
// vanish. Areas: doors/hooks.ts ↔ engines). loadManifest VALIDATES
// workflow.settle_mode (hooks.ts:612-616: a bad value throws
// "workflow.settle_mode must be marker or status-first") and
// workflow.fallback_ladder (hooks.ts:618-620: "must be a boolean") —
// the Manifest type carries both (hooks.ts:420) — but the returned
// workflow object (hooks.ts:681) never includes them. The engine's
// read (orchestrator.ts:1299-1300: `manifest.workflow.settle_mode`,
// `manifest.workflow.fallback_ladder`) therefore sees undefined for
// EVERY program, however declared: the run proceeds in marker mode
// with the stall ladder armed — exactly the two behaviors the program
// author's declaration asks the rail NOT to use. The docs advertise
// the path (docs/adr/0015: `workflow.settle_mode = "status-first"`;
// docs/RAILS.md:50: "(settle_mode, fallback_ladder) compose the
// seating"), and the repo's own completion-detection health fixture
// (test/e2e/forgotten-marker/workflow.toml) declares both — that
// battery scenario exercises marker+ladder while believing it
// exercises the pen. This diff edited the exact carrier line twice
// (born_ms in the type, hooks.ts:420, and in the return,
// hooks.ts:681) and again left these two twins on the floor: the same
// return statement that learned born_ms still drops them.
//
// Verified on BASE daa61ea too (the loadManifest drop predates this
// diff — the diff adopted born_ms onto the line without adopting its
// neighbors): the classification below belongs to the prove gate;
// the INV-2 checklist test fails on HEAD either way.
test("a declared settle_mode/fallback_ladder reaches the manifest the engine reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "whl-p30-"))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "workflow.toml"),
      [
        "[workflow]",
        `name = "p30"`,
        `worker_kind = "opencode"`,
        `settle_mode = "status-first"`,
        `fallback_ladder = false`,
        "",
      ].join("\n"),
    )
    // the parse must not refuse (both values are the documented legal
    // spellings — a throw here would be the OTHER bug)
    const m = loadManifest(dir)
    assert.equal(
      m.workflow.settle_mode,
      "status-first",
      `INV-2 (refuse, never vanish): loadManifest VALIDATES workflow.settle_mode (hooks.ts:612 throws on a bad ` +
        `value) and the Manifest type carries it (hooks.ts:420), but the returned workflow object (hooks.ts:681) ` +
        `omits it — the engine's read (orchestrator.ts:1299 "manifest.workflow.settle_mode") always sees undefined, ` +
        `so a program declaring the ADR-0015 completion-detection switch runs in marker mode with no refusal and ` +
        `no receipt. Got: ${JSON.stringify(m.workflow.settle_mode)}.`,
    )
    assert.equal(
      m.workflow.fallback_ladder,
      false,
      `INV-2 (refuse, never vanish): workflow.fallback_ladder is validated (hooks.ts:618 throws on a non-boolean) ` +
        `and read by the engine (orchestrator.ts:1300 "manifest.workflow.fallback_ladder" — false unseats the stall ` +
        `judge, benchOrder), but the returned workflow object (hooks.ts:681) omits it — the ladder stays armed no ` +
        `matter what the program declares. Got: ${JSON.stringify(m.workflow.fallback_ladder)}.`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
