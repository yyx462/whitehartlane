import assert from "node:assert/strict"
import test from "node:test"
import { orchestratorBrief } from "../src/roles.ts"

test("the orchestrator brief is the ledger and does not write the protocol", () => {
  const brief = orchestratorBrief()
  assert.match(brief, /You are the orchestrator/)
  assert.match(brief, /Stay idle/)
  assert.match(brief, /Do not call herdr/)
  assert.match(brief, /decision.txt/)
  assert.equal(brief.includes("protocol"), false)
  assert.equal(brief.includes("agent wait"), false)
})
