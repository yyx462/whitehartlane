import assert from "node:assert/strict"
import test from "node:test"
import { actorBrief, orchestratorBrief } from "../src/roles.ts"

test("the orchestrator brief is the ledger and does not write the protocol", () => {
  const brief = orchestratorBrief()
  assert.match(brief, /You are the orchestrator/)
  assert.match(brief, /Stay idle/)
  assert.match(brief, /Do not call herdr/)
  assert.match(brief, /decision.txt/)
  assert.equal(brief.includes("protocol"), false)
  assert.equal(brief.includes("agent wait"), false)
})

test("the actor brief is the program's own text — no OS-injected target", () => {
  const brief = actorBrief("Read the target skill. Do not edit it.")
  assert.match(brief, /You are the actor/)
  assert.match(brief, /Read the target skill/)
  assert.equal(brief.includes("Target:"), false)
  assert.equal(brief.includes("SKILL_RSI"), false)
})
