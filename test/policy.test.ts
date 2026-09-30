import assert from "node:assert/strict"
import test from "node:test"
import { admitDirect, admitFanOut, admitWorkerSpawn } from "../src/policy.ts"

test("direct is always admitted — no pane is born, so nothing to check", () => {
  assert.deepEqual(admitDirect(), { admit: true })
})

test("fan-out needs a resolved manifest and sane slots", () => {
  assert.deepEqual(admitFanOut({ manifestResolved: false, manifestWhy: "no workflow.toml resolves", slots: 2 }), {
    admit: false,
    why: "no workflow.toml resolves",
  })
  assert.equal(admitFanOut({ manifestResolved: true, slots: 2 }).admit, true)
  assert.equal(admitFanOut({ manifestResolved: true, slots: 0 }).admit, false)
  assert.equal(admitFanOut({ manifestResolved: true, slots: 1.5 }).admit, false)
})

test("worker spawns are refused when settled, full, capped, or shutting down", () => {
  const base = { settled: false, shutdown: false, active: 0, slots: 2, attempts: 0, cap: 3 }
  assert.equal(admitWorkerSpawn(base).admit, true)
  assert.equal(admitWorkerSpawn({ ...base, settled: true }).admit, false)
  assert.equal(admitWorkerSpawn({ ...base, shutdown: true }).admit, false)
  assert.equal(admitWorkerSpawn({ ...base, active: 2 }).admit, false)
  assert.equal(admitWorkerSpawn({ ...base, attempts: 3 }).admit, false)
  const full = admitWorkerSpawn({ ...base, active: 2 })
  assert.match(full.why ?? "", /slots full \(2\/2\)/)
})
