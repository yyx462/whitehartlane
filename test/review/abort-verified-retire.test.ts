// abort-verified-retire — #119's law, pinned: a retire that can fail
// is NAMED. The old abort arm ran `shep retire <label>` inside a
// swallowed try{}, then booked the pane dead via killPane regardless
// — a refused retire read as success and the real pane lived on as a
// zombie (eight survived overnight, 2026-10-14, jobs j-8e8b5e/j-8f9c0c).
// The verified retire prunes the ledger and retries ONCE (the `not in
// ledger` refusal class); a pane that still refuses comes back with
// its stderr as the loud line — a booked death is never silent.
import assert from "node:assert/strict"
import test from "node:test"
import { retirePanesVerified, type PaneRunner } from "../../src/adapters/teardown.ts"

test("a first-refuse retires after prune+retry (the not-in-ledger class)", () => {
  const calls: string[][] = []
  const run: PaneRunner = (args) => {
    calls.push(args)
    if (args[0] === "retire" && calls.filter((c) => c[0] === "retire").length === 1) {
      return { status: 1, stdout: "", stderr: "error: retire: not in ledger: w-momentum-x1" }
    }
    return { status: 0, stdout: "retired", stderr: "" }
  }
  const r = retirePanesVerified(["w-momentum-x1"], run)
  assert.deepEqual(r.closed, ["w-momentum-x1"])
  assert.deepEqual(r.refused, [])
  // retire → prune → retire (exactly one retry, never a spin)
  assert.deepEqual(calls.map((c) => c.join(" ")), ["retire w-momentum-x1", "prune", "retire w-momentum-x1"])
})

test("a still-refused retire comes back NAMED — never silently booked dead", () => {
  const run: PaneRunner = (args) =>
    args[0] === "retire"
      ? { status: 1, stdout: "", stderr: "error: retire: pane is in an unsettled state: w-tests-x2" }
      : { status: 0, stdout: "", stderr: "" }
  const r = retirePanesVerified(["w-tests-x2"], run)
  assert.deepEqual(r.closed, [])
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].label, "w-tests-x2")
  assert.match(r.refused[0].why, /unsettled state/)
})

test("a clean retire needs no prune (the common path stays the common path)", () => {
  const calls: string[][] = []
  const run: PaneRunner = (args) => {
    calls.push(args)
    return { status: 0, stdout: "", stderr: "" }
  }
  const r = retirePanesVerified(["w-a-x3", "w-b-x4"], run)
  assert.deepEqual(r.closed, ["w-a-x3", "w-b-x4"])
  assert.deepEqual(r.refused, [])
  assert.deepEqual(calls.map((c) => c.join(" ")), ["retire w-a-x3", "retire w-b-x4"])
})
