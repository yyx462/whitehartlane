import assert from "node:assert/strict"
import test from "node:test"
import { actorBrief } from "../src/roles.ts"

test("the actor brief is the program's own text — no OS-injected target", () => {
  const brief = actorBrief("Read the target skill. Do not edit it.")
  assert.match(brief, /You are the actor/)
  assert.match(brief, /Read the target skill/)
  assert.equal(brief.includes("Target:"), false)
  assert.equal(brief.includes("SKILL_RSI"), false)
})
