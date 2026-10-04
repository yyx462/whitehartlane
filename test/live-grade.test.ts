import assert from "node:assert/strict"
import test from "node:test"
import { gradeCall } from "../src/live-grade.ts"

test("a done mock is graded once; a blocked mock is not", () => {
  assert.equal(gradeCall("done", false), true)
  assert.equal(gradeCall("done", true), false)
  assert.equal(gradeCall("blocked", false), false)
  assert.equal(gradeCall(null, false), false)
})
