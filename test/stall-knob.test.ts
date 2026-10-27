import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadManifest } from "../src/doors/hooks.ts"

// workflow.stall_ms (the r6 receipt): a review lens synthesizing over
// a large diff goes marker-silent >10 min and the default stall ladder
// ruled it stalled minutes before its done marker landed — the silence
// ceiling is the program's to declare, like drain_timeout_ms.
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-stallknob-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const program = (dir: string, stall?: string) => {
  mkdirSync(join(dir, "hooks"), { recursive: true })
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "stall-knob"
worker_kind = "opencode"
${stall ?? ""}

[[stage]]
id = "one"
topology = "solo"
brief = "x"
`,
  )
  return dir
}

test("stall_ms: parses, rides the manifest, and refuses out-of-range", () => {
  const ok = loadManifest(program(mkdtempSync(join(tmpdir(), "aos-sk1-")), "stall_ms = 1800000"))
  assert.equal(ok.workflow.stall_ms, 1_800_000)
  assert.throws(() => loadManifest(program(mkdtempSync(join(tmpdir(), "aos-sk2-")), "stall_ms = 5000")), /60000-3600000/)
  const none = loadManifest(program(mkdtempSync(join(tmpdir(), "aos-sk3-"))))
  assert.equal(none.workflow.stall_ms, undefined)
})
