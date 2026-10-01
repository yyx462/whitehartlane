import assert from "node:assert/strict"
import test from "node:test"
import { GRILL_ASK, judgeEnough } from "../src/grill.ts"

test("judgeEnough skips on 'just do it' and forces on 'grill me'", () => {
  const prev = process.env.AGENTIC_OS_GRILL
  delete process.env.AGENTIC_OS_GRILL
  try {
    assert.equal(judgeEnough("just do it: add a flag", () => { throw new Error("no") }).enough, true)
    const forced = judgeEnough("grill me about the flag", () => 1)
    assert.equal(forced.enough, false)
    assert.equal(forced.ask, GRILL_ASK)
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_GRILL
    else process.env.AGENTIC_OS_GRILL = prev
  }
})

test("judgeEnough uses the noul score, and a dead jev stays in the chat", () => {
  const prev = process.env.AGENTIC_OS_GRILL
  delete process.env.AGENTIC_OS_GRILL
  try {
    assert.equal(judgeEnough("add --dry-run, print SQL, touch nothing else", () => 0.91).enough, true)
    const thin = judgeEnough("do the thing", () => 0.2)
    assert.equal(thin.enough, false)
    assert.match(thin.ask ?? "", /Ask what is missing/)
    const down = judgeEnough("add a flag", () => { throw new Error("connection refused") })
    assert.equal(down.enough, false)
    assert.match(down.ask ?? "", /jev unavailable/)
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_GRILL
    else process.env.AGENTIC_OS_GRILL = prev
  }
})
