import assert from "node:assert/strict"
import test from "node:test"
import { workflowKind } from "../src/workflow-kind.ts"

test("lab is its own workflow, not a flag inside fan-out", () => {
  assert.equal(workflowKind('kind = "lab"\n'), "lab")
  assert.equal(workflowKind("live = true\n"), "lab")
  assert.equal(workflowKind('kind = "fan-out"\nlive = true\n'), "fan-out")
  assert.equal(workflowKind('name = "three-lookups"\n'), "fan-out")
  assert.throws(() => workflowKind('kind = "swarm"\n'))
})

test("coworker is its own kind — panes that talk, one relay", () => {
  assert.equal(workflowKind('kind = "coworker"\n'), "coworker")
  assert.equal(workflowKind('[workflow]\nkind = "coworker"\n'), "coworker")
})
