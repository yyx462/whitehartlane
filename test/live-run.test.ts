import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { readSignal } from "../src/engines/live-run.ts"
import { protocolPath } from "../src/core/protocol.ts"

test("no protocol births no wave", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-live-"))
  assert.equal(readSignal(dir).kind, "missing")
  writeFileSync(protocolPath(dir), "{")
  assert.equal(readSignal(dir).kind, "partial")
})

test("a stop file is not a wave", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-live-"))
  writeFileSync(protocolPath(dir), JSON.stringify({ stop: true }))
  assert.equal(readSignal(dir).kind, "stop")
})
