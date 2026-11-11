import assert from "node:assert/strict"
import test from "node:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jevChoiceQAsync, jevNoulQ } from "../src/jev/jev.ts"

// Production gates record (yyx-jev decision ledger): a gate id on the
// adapter call must reach the CLI as `--record <gate>`; no gate id must
// NOT. Hermetic: AGENTIC_OS_JEV points at a stub that answers like the
// real CLI and logs argv — no network, no real ledger writes. This file
// is the CAPABLE stub (store help -> 0); jev-record-stale.test.ts is the
// stale-CLI degrade.
const tmp = mkdtempSync(join(tmpdir(), "aos-jev-rec-"))
const argvFile = join(tmp, "argv.log")
const stub = join(tmp, "jev-stub.sh")
writeFileSync(
  stub,
  [
    "#!/bin/sh",
    'printf \'%s\\n\' "$@" >> "$JEV_STUB_ARGV"',
    'case "$1" in',
    "  store) exit 0 ;;",
    '  noul) echo "noul: 0.90" ;;',
    '  choice) echo "choice: direct  p=0.70  confidence=0.90" ;;',
    "esac",
  ].join("\n") + "\n",
)
chmodSync(stub, 0o755)
process.env.AGENTIC_OS_JEV = stub
process.env.JEV_STUB_ARGV = argvFile

test.after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function lastCallArgs(): string[] {
  // the stub appends one line per argv token; read + clear = exactly this call
  const lines = readFileSync(argvFile, "utf8").split("\n").filter(Boolean)
  truncateSync(argvFile)
  return lines
}

test("a gate id reaches the CLI as --record <gate>", () => {
  const p = jevNoulQ("is this enough to run?", "task text", "grill-enough")
  assert.equal(p, 0.9)
  const argv = lastCallArgs()
  const i = argv.indexOf("--record")
  assert.ok(i >= 0, `argv must carry --record: ${JSON.stringify(argv)}`)
  assert.equal(argv[i + 1], "grill-enough")
})

test("no gate id never records", () => {
  jevNoulQ("is this enough to run?", "task text")
  const argv = lastCallArgs()
  assert.equal(argv.indexOf("--record"), -1, `argv must not carry --record: ${JSON.stringify(argv)}`)
})

test("choice calls record too (async path, answer still parsed)", async () => {
  const answer = await jevChoiceQAsync(
    "fan-out or direct?",
    { "fan-out": "independent units", direct: "one piece of work" },
    "task text",
    "workflow-choice",
  )
  assert.deepEqual(answer, { choice: "direct", p: 0.7, confidence: 0.9 })
  const argv = lastCallArgs()
  const i = argv.indexOf("--record")
  assert.ok(i >= 0, `argv must carry --record: ${JSON.stringify(argv)}`)
  assert.equal(argv[i + 1], "workflow-choice")
})
