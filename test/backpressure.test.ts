import assert from "node:assert/strict"
import test from "node:test"
import { RefusedError, withBackpressure } from "../src/core/backpressure.ts"

test("withBackpressure retries refusals with visible lines and events, then succeeds", () => {
  const logs: string[] = []
  const events: { kind: string; payload: Record<string, unknown> }[] = []
  let calls = 0
  const out = withBackpressure(
    () => {
      calls += 1
      if (calls < 3) throw new RefusedError("429 rate limited")
      return "units"
    },
    {
      who: "planner",
      attempts: 3,
      baseMs: 1,
      jitterMs: 0,
      log: (m) => logs.push(m),
      emit: (kind, payload) => events.push({ kind, payload }),
      sleep: () => {},
    },
  )
  assert.equal(out, "units")
  assert.equal(calls, 3)
  assert.equal(logs.length, 2)
  assert.match(logs[0]!, /planner refused \(attempt 1\/3\).*429/)
  assert.equal(events.length, 2)
  assert.equal(events[0]!.kind, "backpressure")
  assert.equal(events[0]!.payload.who, "planner")
})

test("withBackpressure fails fast on deterministic errors — no doom loop", () => {
  let calls = 0
  assert.throws(
    () =>
      withBackpressure(
        () => {
          calls += 1
          throw new Error("invalid api key")
        },
        { attempts: 3, baseMs: 1, sleep: () => {} },
      ),
    /invalid api key/,
  )
  assert.equal(calls, 1)
})

test("withBackpressure rethrows after the cap when refused every time", () => {
  let calls = 0
  const sleeps: number[] = []
  assert.throws(
    () =>
      withBackpressure(
        () => {
          calls += 1
          throw new RefusedError("overloaded")
        },
        { attempts: 3, baseMs: 100, jitterMs: 0, sleep: (ms) => sleeps.push(ms) },
      ),
    /provider refused: overloaded/,
  )
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [100, 200], "exponential backoff between tries")
})

test("withBackpressure honors AGENTIC_OS_BACKOFF_MS as the base", () => {
  process.env.AGENTIC_OS_BACKOFF_MS = "7"
  const sleeps: number[] = []
  try {
    assert.throws(() =>
      withBackpressure(() => {
        throw new RefusedError("x")
      }, { attempts: 2, jitterMs: 0, sleep: (ms) => sleeps.push(ms) }),
    )
    assert.deepEqual(sleeps, [7])
  } finally {
    delete process.env.AGENTIC_OS_BACKOFF_MS
  }
})
