import assert from "node:assert/strict"
import test from "node:test"
import { orchestratorBin, workflowKind } from "../src/workflow-kind.ts"

test("lab is its own workflow, not a flag inside fan-out", () => {
  assert.equal(workflowKind('kind = "lab"\n'), "lab")
  assert.equal(workflowKind("live = true\n"), "lab")
  assert.equal(workflowKind('kind = "fan-out"\nlive = true\n'), "fan-out")
  assert.equal(workflowKind('name = "three-lookups"\n'), "fan-out")
  assert.equal(orchestratorBin("lab"), "lab-orchestrator")
  assert.equal(orchestratorBin("fan-out"), "fan-out-orchestrator")
  assert.throws(() => workflowKind('kind = "swarm"\n'))
})
