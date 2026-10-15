import assert from "node:assert/strict"
import test from "node:test"
import { refreshWait } from "../src/refresh.ts"

test("refresh waits while the drain is still running", () => {
  assert.equal(refreshWait("running", 0, 10_000), "wait")
  assert.equal(refreshWait("running", 9_999, 10_000), "wait")
})

test("refresh continues only once the drain has booked paused", () => {
  assert.equal(refreshWait("paused", 1_000, 10_000), "continue")
})

test("refresh does not continue if the job left running some other way", () => {
  assert.equal(refreshWait("aborted", 1_000, 10_000), "stopped")
  assert.equal(refreshWait("orphaned", 1_000, 10_000), "stopped")
})

test("refresh gives up at the ceiling and does not continue a still-running drain", () => {
  assert.equal(refreshWait("running", 10_000, 10_000), "timeout")
})
