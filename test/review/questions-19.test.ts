// questions-2 (questions lens, Q1/Q5; file questions-19) — the supervisor's levy is a
// shell command COPIED verbatim into the brief and run as-is by the
// agent (ship-supervisor.ts:18-21: "the levy command is COPIED into
// the supervisor's brief and run verbatim; a title with an apostrophe
// must not break the spell"). bin/whitehartlane:467 q()-quotes --title
// and --merge-cmd but interpolates the REPO PATH and --out unquoted —
// a legal repo path containing a space splits into wrong argv the
// moment the supervisor runs its levy: whl review addresses a
// nonexistent repo "/…/My", the rail never levies, no verdict.json is
// ever written, and the PR never hears anything. The twin was fixed,
// the sibling was left broken.
// (File named questions-19: questions-1..17.test.ts belong to prior
// review rounds and stay untouched.)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

test("questions-2: the verbatim levy in the supervisor brief addresses THE repo even when the path has a space", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "q2-auto-"))
  try {
    const repo = fixtureRepo(join(tmp, "My Repo"))
    const argvPath = join(tmp, "argv.txt")
    const stub = join(tmp, "stub-supervisor")
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvPath)}\necho up\n`)
    chmodSync(stub, 0o755)
    spawnSync(process.execPath, [BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/m"], {
      encoding: "utf8",
      timeout: 90_000,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: tmp,
        AGENTIC_OS_HOME: tmp,
        AGENTIC_OS_NOTIFY: "0",
        WHL_JEV_BIN: "/nonexistent-jev", // jev down → fail-safe REVIEW → the --auto door mints the supervisor
        WHL_SUPERVISOR_BIN: stub,
      },
    })
    // the stub records the brief asynchronously; the parent exits first
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(100)
      if (existsSync(argvPath)) argv = readFileSync(argvPath, "utf8")
    }
    if (!argv.trim()) return // BASE behavior: no --auto door, no supervisor minted — nothing to hold to account
    const levy = argv.split("\n").map((l) => l.trim()).find((l) => l.startsWith("whl review "))
    assert.ok(levy, "the brief carries the levy command")
    // the round-trip the supervisor itself performs: run the levy line
    // through a REAL /bin/sh and look at the argv the shell hands over
    const rt = join(tmp, "roundtrip.sh")
    writeFileSync(rt, `#!/bin/sh\nset -- ${levy}\nprintf '%s' "$3"\n`)
    chmodSync(rt, 0o755)
    const word3 = spawnSync(rt, [], { encoding: "utf8" }).stdout
    assert.equal(
      word3,
      repo,
      `the supervisor's verbatim levy must address THE repo as one shell word — the shell split it into [${word3}] — levy:\n${levy}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
