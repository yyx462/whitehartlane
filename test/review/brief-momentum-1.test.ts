// INV-3: "how long to wait before retrying a refused agent CLI" has one
// owner — retries()/backoffBase()/backoffMs() (src/adapters/backoff.ts,
// the start loop at opencode-host.ts:114-128). The brief-delivery loop
// (opencode-host.ts:150-159) makes the same decision with a private
// counter and a flat sleepSync(1000). A prompt refusal that ends inside
// the owner's first pause therefore retires a birth the start guard
// would have survived (ADR 0010: brownouts last seconds, not one flat beat).
//
// Run outside node:test so backoffBase returns its production default
// (under NODE_TEST_CONTEXT it clamps to 0 and the disagreement hides).
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const child = `
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { backoffBase, backoffMs } from "./src/adapters/backoff.ts"
import { OpenCodeHost } from "./src/adapters/opencode-host.ts"

const dir = mkdtempSync(join(tmpdir(), "momentum-brief-backoff-"))
writeFileSync(join(dir, "brief.md"), "do the thing\\n")
delete process.env.AGENTIC_OS_START_BACKOFF_MS
delete process.env.AGENTIC_OS_BRIEF_TRIES
delete process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
const ownerFirstPause = backoffMs(backoffBase("AGENTIC_OS_START_BACKOFF_MS", 5_000), 1)
process.env.AGENTIC_OS_BIRTH_JITTER_MS = "0"
process.env.AGENTIC_OS_START_TRIES = "1"
process.env.AGENTIC_OS_START_BACKOFF_MS = "0"
if (ownerFirstPause !== 5000) {
  console.log(JSON.stringify({ ok: false, why: "owner scale", ownerFirstPause, nodeTest: process.env.NODE_TEST_CONTEXT ?? null }))
  process.exit(2)
}
const started = Date.now()
const brownoutUntil = started + ownerFirstPause / 2
let prompts = 0
const transport = {
  exec: (...args) => {
    if (args[0] === "agent" && args[1] === "prompt") {
      prompts += 1
      if (Date.now() < brownoutUntil) return { status: 1, stdout: "", stderr: "not ready" }
    }
    return { status: 0, stdout: "", stderr: "" }
  },
  splitPane: () => null,
  closePane: () => {},
  renamePane: () => {},
  layoutOf: () => null,
  tabCreate: () => ({ root: null, tab: null, status: 0 }),
  closeTab: () => {},
}
const ok = new OpenCodeHost(transport, () => {}).inhabit("actor", "p-1", {
  kind: "opencode",
  briefPath: join(dir, "brief.md"),
  cwd: dir,
  model: "zhipuai/glm-5.3",
  hold: false,
})
console.log(JSON.stringify({ ok, prompts, ownerFirstPause, elapsed: Date.now() - started }))
process.exit(ok ? 0 : 1)
`

test("a brief refusal inside the start-loop owner's first pause must not kill the birth (INV-3)", () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  delete env.AGENTIC_OS_BRIEF_TRIES
  delete env.AGENTIC_OS_BRIEF_BACKOFF_MS
  env.AGENTIC_OS_ORCHESTRATOR = join(import.meta.dirname, "..", "orchestrator-stub.mjs")
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", child], {
    cwd: join(import.meta.dirname, "..", ".."),
    env,
    encoding: "utf8",
    timeout: 20_000,
  })
  const line = (run.stdout ?? "").trim().split("\n").pop()
  let parsed: { ok?: boolean; prompts?: number; ownerFirstPause?: number; elapsed?: number } = {}
  try {
    parsed = JSON.parse(line ?? "")
  } catch {
    parsed = {}
  }
  assert.equal(
    parsed.ok,
    true,
    `INV-3: brief-refusal wait must route through backoffBase/backoffMs (owner first pause ${parsed.ownerFirstPause}ms); a refusal that clears at half that pause must not retire the birth (prompt attempts=${parsed.prompts}, elapsed=${parsed.elapsed}ms, exit=${run.status}, stderr=${(run.stderr ?? "").slice(0, 400)})`,
  )
})
