// Fault: unset AGENTIC_OS_BRIEF_BACKOFF_MS must not be pause 0.
// The birth grace claims a 1000ms default (opencode-host.ts) and the
// sibling parser backoffBase treats "" as unset. Number("") === 0, so
// the else-branch 1_000 is dead on the production path.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { OpenCodeHost } from "../../src/adapters/opencode-host.ts"
import type { Transport } from "../../src/ports/transport.ts"

function transport(promptStatuses: number[]): { transport: Transport; prompts: number } {
  const state = { prompts: 0 }
  const transport: Transport = {
    exec(...args: string[]) {
      if (args[0] === "agent" && args[1] === "start") return { status: 0, stdout: "", stderr: "" }
      if (args[0] === "agent" && args[1] === "prompt") {
        const status = promptStatuses[Math.min(state.prompts, promptStatuses.length - 1)] ?? 1
        state.prompts += 1
        return { status, stdout: "", stderr: "" }
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
  return { transport, get prompts() { return state.prompts } } as { transport: Transport; prompts: number }
}

test("unset AGENTIC_OS_BRIEF_BACKOFF_MS pauses the claimed 1000ms default between refused brief submissions", () => {
  delete process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
  delete process.env.AGENTIC_OS_BRIEF_TRIES
  delete process.env.AGENTIC_OS_BIRTH_JITTER_MS
  const dir = mkdtempSync(join(tmpdir(), "aos-brief-pause-"))
  const briefPath = join(dir, "brief.md")
  writeFileSync(briefPath, "the brief\n")
  const fake = transport([1, 1, 0])
  const host = new OpenCodeHost(fake.transport)
  const t0 = Date.now()
  const ok = host.inhabit("m", "p", { kind: "opencode", briefPath, cwd: dir, hold: false })
  const elapsed = Date.now() - t0
  assert.equal(ok, true, "a later attempt must still deliver")
  assert.equal(fake.prompts, 3, "two refusals then a delivery")
  // two inter-attempt pauses at the claimed default of 1000ms
  assert.ok(
    elapsed >= 1500,
    `INV-3: unset AGENTIC_OS_BRIEF_BACKOFF_MS must use the 1000ms default (backoffBase's empty-means-unset rule), not Number("")===0 — elapsed ${elapsed}ms for two pauses`,
  )
})
