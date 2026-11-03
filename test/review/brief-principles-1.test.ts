// INV-3: "how long to wait before retrying a refused host command" has
// one owner — backoffBase (src/adapters/backoff.ts). The brief-delivery
// loop (src/adapters/opencode-host.ts) re-parses the knob itself and
// collapses an unset env into "" via `?? ""`. Number("") is 0, which
// passes `Number.isFinite && >= 0`, so the documented fallback of
// 1_000ms is dead code. A pane that is not ready yet (the brownout the
// start-retry twin waits out) is prompted three times in one tick and
// the birth fails.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { OpenCodeHost } from "../../src/adapters/opencode-host.ts"
import type { Transport } from "../../src/ports/transport.ts"

test("unset AGENTIC_OS_BRIEF_BACKOFF_MS waits the documented pause, not 0ms", () => {
  const saved = process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
  const savedTries = process.env.AGENTIC_OS_BRIEF_TRIES
  const savedJitter = process.env.AGENTIC_OS_BIRTH_JITTER_MS
  delete process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
  delete process.env.AGENTIC_OS_BRIEF_TRIES
  delete process.env.AGENTIC_OS_BIRTH_JITTER_MS
  const times: number[] = []
  const transport: Transport = {
    exec(...args: string[]) {
      if (args[0] === "agent" && args[1] === "start") return { status: 0, stdout: "", stderr: "" }
      if (args[0] === "agent" && args[1] === "prompt") {
        times.push(Date.now())
        return { status: 1, stdout: "", stderr: "" }
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
  const dir = mkdtempSync(join(tmpdir(), "principles-brief-pause-"))
  const briefPath = join(dir, "brief.md")
  writeFileSync(briefPath, "brief body\n")
  try {
    const ok = new OpenCodeHost(transport, () => {}).inhabit("m", "p", {
      kind: "opencode",
      briefPath,
      cwd: dir,
      hold: false,
    })
    assert.equal(ok, false, "all-fail still fails honestly")
    assert.ok(times.length >= 2, `expected a retry, got ${times.length} prompt(s)`)
    const gap = times[1]! - times[0]!
    assert.ok(
      gap >= 1_000,
      `INV-3: unset AGENTIC_OS_BRIEF_BACKOFF_MS must wait the documented 1000ms between refused brief submissions (start-retry routes through backoffBase, which does not treat unset as 0); gap was ${gap}ms — Number("") is 0, so the 1_000 fallback is dead and a not-ready pane is exhausted in one tick`,
    )
  } finally {
    if (saved === undefined) delete process.env.AGENTIC_OS_BRIEF_BACKOFF_MS
    else process.env.AGENTIC_OS_BRIEF_BACKOFF_MS = saved
    if (savedTries === undefined) delete process.env.AGENTIC_OS_BRIEF_TRIES
    else process.env.AGENTIC_OS_BRIEF_TRIES = savedTries
    if (savedJitter === undefined) delete process.env.AGENTIC_OS_BIRTH_JITTER_MS
    else process.env.AGENTIC_OS_BIRTH_JITTER_MS = savedJitter
  }
})
