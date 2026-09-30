import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// units.sh classifies; the rail retries. Exit contract: 75 = provider
// refused (retryable), 1 = deterministic (fail fast), 0 = JSONL ready.
const UNITS_SH = join(import.meta.dirname, "..", "global", "hooks", "units.sh")

function run(cwd: string, planner: string) {
  try {
    const stdout = execFileSync("bash", [UNITS_SH], { cwd, encoding: "utf8", env: { ...process.env, AGENTIC_OS_PLANNER: planner } })
    return { status: 0, stdout }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? "" }
  }
}

function fixture(dir: string, name: string, body: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test("units.sh exits 75 when the planner refusal pattern matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-units-"))
  writeFileSync(join(dir, "task.txt"), "look up three things\n")
  const planner = fixture(dir, "refuse.sh", `echo "API error: 429 Your rate limit is reached" >&2; exit 1`)
  const r = run(dir, planner)
  assert.equal(r.status, 75)
})

test("units.sh exits 1 on a deterministic planner failure — retrying would show the same doom thrice", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-units-"))
  writeFileSync(join(dir, "task.txt"), "look up three things\n")
  const planner = fixture(dir, "hard.sh", `echo "invalid api key" >&2; exit 1`)
  const r = run(dir, planner)
  assert.equal(r.status, 1)
})

test("units.sh exits 1 when the planner output is empty with rc 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-units-"))
  writeFileSync(join(dir, "task.txt"), "look up three things\n")
  const planner = fixture(dir, "empty.sh", `exit 0`)
  const r = run(dir, planner)
  assert.equal(r.status, 1)
})

test("units.sh passes the JSONL through on success", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-units-"))
  writeFileSync(join(dir, "task.txt"), "look up three things\n")
  const planner = fixture(dir, "ok.sh", `echo '{"id":"a","brief":"do a"}'`)
  const r = run(dir, planner)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\{"id":"a","brief":"do a"\}/)
})

test("units.sh fails fast without task.txt", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-units-"))
  const planner = fixture(dir, "ok.sh", `echo '{"id":"a","brief":"x"}'`)
  const r = run(dir, planner)
  assert.equal(r.status, 1)
})
