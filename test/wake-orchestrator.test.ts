import assert from "node:assert/strict"
import test from "node:test"
import { wakesFor, waveClosed } from "../src/live-run.ts"

test("a blocked mock wakes the orchestrator and a done mock does not", () => {
  const ends = [
    { id: "france", end: "done" },
    { id: "japan", end: "blocked" },
  ]
  assert.deepEqual(wakesFor(ends, []), ["japan"])
  assert.deepEqual(wakesFor(ends, ["japan"]), [])
})

test("the wave is closed only when every mock has an end", () => {
  assert.equal(waveClosed([{ id: "france", end: "done" }, { id: "japan", end: null }]), false)
  assert.equal(waveClosed([{ id: "france", end: "done" }, { id: "japan", end: "blocked" }]), true)
  assert.equal(waveClosed([]), false)
})
