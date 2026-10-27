// INV-2 (refuse, never vanish): the pr-review template's own program
// (templates/pr-review/workflow.toml, new in this change) pins a
// temperature on every lens unit — principles 0.2, tests 0.4, momentum
// 0.6, questions 0.8 — and templates/pr-review/README.md advertises
// those pins ("principles (0.2) — …"). But the stage parser's units
// mapping (src/doors/hooks.ts stagesFromRaw, the `stage.units =
// t.units.map(...)` block) reads only id/brief/model from each unit
// table; `temperature` is silently dropped. The engine's temperature
// plan — settingsPlanFromStages, consumed by runOrchestrator
// (src/engines/orchestrator.ts: "const unitTemperatures =
// settingsPlanFromStages(stages)") and handed to spawnWorker →
// opencode-host's settings write — therefore sees an empty map on
// EVERY `whl review` run: all four lenses levy at the host default.
// The field is accepted by the door and vanishes before the engine —
// exactly the INV-2 class (refuse, never vanish; areas:
// doors/hooks.ts ↔ engines).
//
// The assertion below names the invariant: either the parser refuses
// the field, or the parsed stage must carry it into the engine's own
// receipt (settingsPlanFromStages). Today it does neither — the pin
// evaporates between hooks.ts and orchestrator.ts.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadManifest, settingsPlanFromStages } from "../src/doors/hooks.ts"

test("INV-2: a fan-out unit's temperature pin reaches the engine's settings plan (or the door refuses the field)", () => {
  const dir = mkdtempSync(join(tmpdir(), "principles-inv2-"))
  try {
    // the template's lens stage, minimized but field-for-field faithful
    // (worker_kind/grade/check/units exactly as templates/pr-review/
    // workflow.toml declares them)
    writeFileSync(
      join(dir, "workflow.toml"),
      `[workflow]
name = "principles-inv2"
worker_kind = "opencode"

[[stage]]
id = "lenses"
topology = "fan-out"
grade = false
check = "bash hooks/findings-check.sh"
units = [
  { id = "principles", temperature = 0.2, brief = "x" },
  { id = "questions", temperature = 0.8, brief = "y" },
]
`,
    )
    const m = loadManifest(dir)
    const stages = m.stages ?? []
    assert.equal(stages.length, 1, "the lens stage parses")
    // the engine's own receipt: orchestrator.ts feeds exactly this map
    // to spawnWorker's temperature parameter
    const pins = settingsPlanFromStages(stages)
    assert.ok(
      pins.get("principles") === 0.2 && pins.get("questions") === 0.8,
      `INV-2: the door accepts units[].temperature but it vanishes before the ` +
        `engine — settingsPlanFromStages saw ${JSON.stringify([...pins])} ` +
        `(refuse, never vanish)`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
