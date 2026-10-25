import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runFaultLane } from "../src/engines/fault-lane.ts"
import { readModelsFile } from "../src/jev/model-ladder.ts"

// j-93d652 gap #4 — the provider-fault lane, ONE algorithm for both
// engines. These pin the lane's own law: switch in-session with the
// rail's note, never double-fire one fault, and close honestly when
// the candidate set is spent.
test("the fault lane switches a faulting worker in-session, dedups a fault, and closes when candidates run out", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-flane-"))
  writeFileSync(join(dir, "models.json"), JSON.stringify({ mode: "auto", order: ["a/one", "a/two"] }))
  const policy = readModelsFile(dir, "", null)

  let fault: { id: string; type: string } | null = { id: "f1", type: "provider.rate-limit" }
  let status = "idle"
  const switches: string[] = []
  const prompts: [string, string][] = []
  const closes: string[] = []
  const clocks: string[] = []
  const rail = {
    workerStatus: () => status,
    latestSessionFault: () => fault,
    switchSessionModel: (_sid: string, model: string) => {
      switches.push(model)
      return { ok: true }
    },
    promptAgent: (name: string, text: string) => prompts.push([name, text]),
  }
  const models = new Map([["u1", "a/one"]])
  const awaitingTurn = new Set<string>()
  const actedFault = new Map<string, string>()
  const deadModels = new Map<string, Set<string>>()

  const lane = () =>
    runFaultLane({
      taskDir: dir,
      names: ["u1"],
      sessionOf: () => "s1",
      cwdOf: () => dir,
      modelOf: (n) => models.get(n),
      setModel: (n, m) => models.set(n, m),
      isDead: () => false,
      awaitingTurn,
      actedFault,
      deadModels,
      policy,
      rail,
      close: (_n, why) => closes.push(why),
      resetClock: (n) => clocks.push(n),
      log: () => {},
    })

  // beat 1: the fault fires — switch one -> two inside the session, the
  // rail note lands, the stall clock resets, the turn is awaited
  lane()
  assert.deepEqual(switches, ["a/two"])
  assert.equal(models.get("u1"), "a/two")
  assert.match(prompts[0]![1], /provider refused another turn/)
  assert.ok(awaitingTurn.has("u1"))
  assert.deepEqual(clocks, ["u1"])

  // beat 2: same fault, worker not yet working — the lane holds, no
  // double switch
  lane()
  assert.equal(switches.length, 1)

  // beat 3: the worker is working on the new model — the await clears,
  // and the SAME fault id never re-fires (actedFault dedup)
  status = "working"
  lane()
  assert.ok(!awaitingTurn.has("u1"))
  lane()
  assert.equal(switches.length, 1)

  // beat 4: a NEW fault on the replacement — every candidate is spent,
  // the lane closes through the caller's ceremony, honestly
  fault = { id: "f2", type: "provider.rate-limit" }
  lane()
  assert.equal(closes.length, 1)
  assert.match(closes[0]!, /model ladder is empty|every candidate model has failed/)
})
