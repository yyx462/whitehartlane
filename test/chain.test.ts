// The chain object (OPTIMUM §2 endgame, stated in #164's PR body):
// ONE owner of the wave order, the frontier predicate, and
// unreachability. These tests pin the semantics the four step machines
// used to hand-roll separately — the walker's behavior on top of it is
// covered by orchestrator/stages/wake-steps integration tests.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace (OPTIMUM §8) — card tests
// resolve a session there, so they need their own disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-chain-"))

import { chainOf, stepRecorder } from "../src/orchestrator-chain.ts"
import { readCheckpoints } from "../src/state.ts"
import type { Step } from "../src/hooks.ts"

const stepsOf = (rows: [id: string, by: Step["finished_by"], wave: string][]): Step[] =>
  rows.map(([id, finished_by, wave]) => ({ id, finished_by, wave }))

test("chainOf: no steps — the trivial chain (units-hook programs)", () => {
  const chain = chainOf(undefined)
  assert.deepEqual(chain.steps, [])
  assert.deepEqual(chain.waveOrder, [])
  assert.deepEqual(chain.watched, [])
  // everything open, nothing unreachable, done condition trivially true
  const finished = new Set<string>()
  const failed = new Set<string>()
  assert.equal(chain.frontier("w1", finished, failed), true)
  assert.deepEqual(chain.gateOf("any-unit", finished, failed), { open: true })
  assert.equal(chain.watched.every((s) => chain.unreachable(s, failed)), true)
})

test("chainOf: wave order is declaration order; kind slices partition watched", () => {
  const chain = chainOf(stepsOf([
    ["ingest", "end", "w1"],
    ["a1", "end", "w2"], ["a2", "end", "w2"],
    ["review", "check", "w3"],
    ["negotiate", "wake", "w4"],
    ["grade", "gate", "w5"],
  ]))
  assert.deepEqual(chain.waveOrder, ["w1", "w2", "w3", "w4", "w5"])
  assert.deepEqual(chain.checks.map((s) => s.id), ["review"])
  assert.deepEqual(chain.gates.map((s) => s.id), ["grade"])
  assert.deepEqual(chain.wakes.map((s) => s.id), ["negotiate"])
  assert.deepEqual(chain.watched.map((s) => s.id), ["review", "negotiate", "grade"])
  assert.deepEqual(chain.steps.filter((s) => s.finished_by === "end").map((s) => s.id), ["ingest", "a1", "a2"])
})

test("frontier: a wave opens only when every earlier step finished done", () => {
  const chain = chainOf(stepsOf([
    ["g0", "end", "w1"],
    ["review", "check", "w2"],
    ["g1", "end", "w3"],
  ]))
  const finished = new Set<string>()
  const failed = new Set<string>()
  assert.equal(chain.frontier("w2", finished, failed), false, "nothing finished — w2 waits")
  assert.deepEqual(chain.gateOf("review", finished, failed), { open: false }, "no blocker named while waiting")
  assert.deepEqual(chain.gateOf("g1", finished, failed), { open: false })
  finished.add("g0")
  assert.equal(chain.frontier("w2", finished, failed), true, "prior wave done — w2 opens")
  assert.deepEqual(chain.gateOf("review", finished, failed), { open: true })
  assert.equal(chain.frontier("w3", finished, failed), false, "w2's steps must finish before w3 opens")
})

test("a failed prior closes the wave AND names the blocker (the honest row)", () => {
  const chain = chainOf(stepsOf([
    ["g0", "end", "w1"],
    ["review", "check", "w2"],
    ["g1", "end", "w3"],
  ]))
  const finished = new Set<string>(["g0"])
  const failed = new Set<string>(["review"])
  assert.equal(chain.frontier("w3", finished, failed), false)
  assert.deepEqual(chain.gateOf("g1", finished, failed), { open: false, blockedBy: "review" })
  assert.equal(chain.unreachable(chain.steps[2]!, failed), true, "g1's wave is behind the failure")
  assert.equal(chain.unreachable(chain.steps[1]!, failed), false, "review itself is not behind one")
})

test("failure wins over lateness: a failed prior blocks even with unfinished ones before it", () => {
  const chain = chainOf(stepsOf([
    ["a", "end", "w1"],
    ["b", "end", "w2"],
    ["c", "end", "w3"],
  ]))
  const finished = new Set<string>(["a"])
  const failed = new Set<string>(["b"])
  // c waits on nobody finished (b failed, not unfinished) — the failed
  // prior is the named blocker; the wave is unreachable, not late
  assert.deepEqual(chain.gateOf("c", finished, failed), { open: false, blockedBy: "b" })
  assert.equal(chain.unreachable(chain.steps[2]!, failed), true)
})

test("a unit with no wave (units-hook id beside steps) is always open", () => {
  const chain = chainOf(stepsOf([["g0", "end", "w1"]]))
  assert.equal(chain.waveOf("stranger"), undefined)
  assert.deepEqual(chain.gateOf("stranger", new Set(), new Set()), { open: true })
})

test("stepRecorder: one settle card, one event, one row — the one ceremony", () => {
  const dir = mkdtempSync(join(tmpdir(), "chain-recorder-"))
  try {
    const events: { kind: string; payload: Record<string, unknown> }[] = []
    const rows: { unit: string; result: string; pass: boolean }[] = []
    const record = stepRecorder(dir, (kind, payload) => events.push({ kind, payload }), rows)
    record("sub", "wake", false, "child j-1 failed".slice(0, 120), "child j-1 failed — stage check failed: boom")
    assert.deepEqual(rows, [{ unit: "sub", result: "child j-1 failed — stage check failed: boom", pass: false }])
    assert.deepEqual(events, [{ kind: "unit.finished", payload: { unit: "sub", pass: false, result: "child j-1 failed — stage check failed: boom" } }])
    const cards = readCheckpoints(dir)
    assert.equal(cards.length, 1)
    assert.deepEqual(
      { stage: cards[0]!.stage, status: cards[0]!.status, unit: cards[0]!.unit },
      { stage: "wake:sub", status: "FAILED", unit: "sub" },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
