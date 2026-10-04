import assert from "node:assert/strict"
import test from "node:test"
import { paneName } from "../src/roles.ts"

test("a pane has a role name, and a mock without an id fails", () => {
  assert.equal(paneName("orchestrator"), "orchestrator")
  assert.equal(paneName("actor"), "actor")
  assert.equal(paneName("mock", "flink-checkpoint-explain"), "mock-flink-checkpoint-explain")
  assert.throws(() => paneName("mock"), /needs a name/)
  assert.throws(() => paneName("mock", "  "), /needs a name/)
})
