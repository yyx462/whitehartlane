import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { birthWave, protocolPath } from "../src/protocol.ts"

function jobDir(): string {
  return mkdtempSync(join(tmpdir(), "agentic-os-protocol-"))
}

test("an idle orchestrator with no protocol file births nothing", () => {
  const dir = jobDir()
  let spawned = 0
  const wave = birthWave(dir, { idle: true, spawn: () => { spawned += 1 } })
  assert.equal(wave, null)
  assert.equal(spawned, 0)
  assert.equal(existsSync(join(dir, "wave.json")), false)
})

test("a partial protocol file births nothing and does not spawn", () => {
  const dir = jobDir()
  writeFileSync(protocolPath(dir), JSON.stringify({ units: [{ id: "france" }] }))
  let spawned = 0
  const wave = birthWave(dir, { idle: true, spawn: () => { spawned += 1 } })
  assert.equal(wave, null)
  assert.equal(spawned, 0)
  assert.equal(existsSync(join(dir, "wave.json")), false)
})

test("a complete protocol file births a wave record and does not spawn on idle", () => {
  const dir = jobDir()
  writeFileSync(protocolPath(dir), JSON.stringify({
    units: [{ id: "france", brief: "name the capital" }],
  }))
  let spawned = 0
  const wave = birthWave(dir, { idle: true, spawn: () => { spawned += 1 } })
  assert.deepEqual(wave, { units: [{ id: "france", brief: "name the capital" }] })
  assert.equal(spawned, 0)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "wave.json"), "utf8")), wave)
})
