import assert from "node:assert/strict"
import test from "node:test"
import { beat, closes, note, verboseOn } from "../src/verbose.ts"

test("verbose is on from the template or the flag, and a repeat state writes nothing", () => {
  assert.equal(verboseOn("verbose = true\n"), true)
  assert.equal(verboseOn("verbose = false\n", "1"), true)
  assert.equal(verboseOn("name = \"skill-rsi\"\n"), false)
  const seen = new Map<string, string>()
  const first = note(seen, "mock-a", beat("watcher", "mock-a blocked"))
  const again = note(seen, "mock-a", beat("watcher", "mock-a blocked"))
  const next = note(seen, "mock-a", beat("operator", "close mock-a"))
  assert.equal(first, "watcher mock-a blocked")
  assert.equal(again, null)
  assert.equal(next, "operator close mock-a")
})

test("a finished mock closes; a blocked mock stays", () => {
  assert.equal(closes("done"), true)
  assert.equal(closes("blocked"), false)
  assert.equal(closes(null), false)
})
