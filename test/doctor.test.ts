// doctor.test.ts — the `whl doctor` verb: every check names what it
// proves, reds exit non-zero. Runs against an ISOLATED OS disk (the
// real disk's test orphans are not this suite's concern).
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import assert from "node:assert/strict"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-doctor-home-"))

const bin = join(import.meta.dirname, "..", "bin", "whitehartlane")

test("doctor runs its checks green on a clean isolated disk", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", bin, "doctor"], {
    encoding: "utf8",
    timeout: 60_000,
  })
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  const lines = r.stdout.split("\n").filter((l) => /^(ok|RED)/.test(l))
  assert.ok(lines.length >= 6, `every check reports: ${lines.length}`)
  assert.ok(lines.every((l) => l.startsWith("ok  ")), `all green on a clean disk:\n${lines.join("\n")}`)
  assert.match(r.stdout, /runner boots — refused a program-less dir by name/)
  assert.match(r.stdout, /doctor: \d+ checks green/)
  // tenancy: a DIAGNOSTIC books nothing — the boot probe's job row
  // lands in its throwaway home, never on the disk doctor is checking
  // (run #12's E2 counted two doctor probes as phantom commissions)
  assert.equal(
    existsSync(join(process.env.AGENTIC_OS_HOME!, "sessions")),
    false,
    "doctor books zero job rows on the home it diagnosed",
  )
})
