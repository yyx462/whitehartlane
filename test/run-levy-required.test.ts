// A Job nobody hears finishing is an information gap (j-b6067c:
// levied without --from, its end reached nobody). The door now
// refuses: book a levy with --from, or choose the humanless path
// explicitly with --unattended.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const door = join(import.meta.dirname, "..", "bin", "agentic-os")

function program(): string {
  const dir = mkdtempSync(join(tmpdir(), "levy-req-"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      "[workflow]",
      'name = "t"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'units = "true"',
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
    ].join("\n"),
  )
  return dir
}

test("run without --from refuses — no Job finishes unheard", () => {
  const home = mkdtempSync(join(tmpdir(), "levy-req-home-"))
  const r = spawnSync(process.execPath, ["--experimental-strip-types", door, "run", program()], {
    env: { ...process.env, AGENTIC_OS_HOME: home },
    encoding: "utf8",
  })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--from <tool>:<session-id>/)
  assert.match(r.stderr, /--unattended/)
  rmSync(home, { recursive: true, force: true })
})

test("--unattended is the explicit humanless path — the job books and runs", () => {
  const home = mkdtempSync(join(tmpdir(), "levy-req-home2-"))
  // a stub orchestrator: the door spawns it detached and reports the job
  const stub = join(home, "stub-orchestrator.mjs")
  writeFileSync(stub, "process.exit(0)\n")
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", door, "run", program(), "--unattended"],
    {
      env: { ...process.env, AGENTIC_OS_HOME: home, AGENTIC_OS_ORCHESTRATOR: stub },
      encoding: "utf8",
    },
  )
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /job: j-/)
  rmSync(home, { recursive: true, force: true })
})
