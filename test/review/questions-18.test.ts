// questions-1 (questions lens, Q5/Q6) — INV-4: verdicts are honest; an
// infra failure is never reported as an answer. `whl review <repo>
// --pr <n> --auto` with a supervisor bin that cannot spawn (opencode
// not on PATH, WHL_SUPERVISOR_BIN typo) prints "supervisor: pid -1
// owns the review of PR #N" and promises the verdict, then the
// process dies on the child's UNHANDLED 'error' (spawn ENOENT). The
// infra failure must land as a reported fault — never as an owned
// commission plus a crash (ship-supervisor.ts:50 even claims "the
// supervisor is never silent, even when it fails to start").
// (File named questions-18: questions-1..17.test.ts belong to prior
// review rounds and stay untouched.)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

test("questions-1: a failed supervisor spawn is infra-as-infra, never an owned commission + unhandled crash", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q1-auto-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = spawnSync(
      process.execPath,
      [BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/m"],
      {
        encoding: "utf8",
        timeout: 90_000,
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          HOME: tmp,
          AGENTIC_OS_HOME: tmp,
          AGENTIC_OS_NOTIFY: "0",
          WHL_JEV_BIN: "/nonexistent-jev", // jev down → fail-safe REVIEW → the --auto door mints the supervisor
          WHL_SUPERVISOR_BIN: join(tmp, "definitely-absent-supervisor"),
        },
      },
    )
    // INV-4, arm 1: the infra failure (supervisor bin ENOENT) must land
    // as a REPORTED fault — an unhandled 'error' crash is not a report
    assert.ok(
      !/Unhandled 'error' event/.test(String(r.stderr)),
      `an infra failure (supervisor bin ENOENT) must land as a report, never an unhandled crash — stderr:\n${String(r.stderr).slice(0, 600)}`,
    )
    // INV-4, arm 2: a spawn that failed is never an OWNED commission —
    // "supervisor: pid -1 owns the review of PR #42" is a verdict-shaped
    // lie (no verdict will ever land, no comment will ever post)
    assert.ok(
      !/supervisor: pid -1 owns the review/.test(String(r.stdout)),
      `a failed spawn must not be reported as an owned commission — stdout:\n${String(r.stdout).slice(0, 600)}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
