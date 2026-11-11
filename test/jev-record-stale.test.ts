import assert from "node:assert/strict"
import test from "node:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jevNoulQ } from "../src/jev/jev.ts"

// Stale-CLI degrade: a jev without `store` (probe fails) must answer the
// gate and OMIT --record — a missing ledger feature never kills the gate.
// Separate file from jev-record.test.ts because the capability probe
// caches per process (node:test gives each file its own process).
const tmp = mkdtempSync(join(tmpdir(), "aos-jev-stale-"))
const argvFile = join(tmp, "argv.log")
const stub = join(tmp, "jev-stub.sh")
writeFileSync(
  stub,
  [
    "#!/bin/sh",
    'printf \'%s\\n\' "$@" >> "$JEV_STUB_ARGV"',
    'case "$1" in',
    "  store) exit 2 ;;",
    '  noul) echo "noul: 0.80" ;;',
    "esac",
  ].join("\n") + "\n",
)
chmodSync(stub, 0o755)
process.env.AGENTIC_OS_JEV = stub
process.env.JEV_STUB_ARGV = argvFile

test.after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

test("a stale CLI answers the gate but records nothing", () => {
  const p = jevNoulQ("is this path needed?", "state text", "permission-needed")
  assert.equal(p, 0.8)
  const argv = readFileSync(argvFile, "utf8").split("\n").filter(Boolean)
  const sawProbe = argv[0] === "store" && argv[1] === "help"
  const call = sawProbe ? argv.slice(2) : argv
  assert.equal(call.indexOf("--record"), -1, `stale CLI must not get --record: ${JSON.stringify(call)}`)
  truncateSync(argvFile)
})
