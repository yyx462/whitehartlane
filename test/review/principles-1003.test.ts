// principles-1003 (P1, INV-3 twin + INV-4): the decision "is there a
// traceable parent" is answered TWICE with two different laws. The
// --auto block (bin/whitehartlane:461-473) answers it with raw
// truthiness — `val("from")` — while the ONE owner of the --from law,
// spawnerFromArgs (src/doors/run.ts:54, ^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$),
// refuses the same value as NOT a pointer. A WHL_FROM that fails the
// grammar (a space, an empty session id, "github:issue#12") is
// therefore treated as "a parent exists" by the mint gate and as "no
// spawner" by the fall-through: the supervisor is NOT minted, the
// levy is NOT booked (no --unattended, spawner null), the PR hears
// NOTHING, and the process exits 0 — while the gate's ledger row
// already promised action:"review" with a full roster. --auto's own
// contract ("A review with no traceable parent MINTS one … posts the
// verdict to the PR") is silently broken; the PR is un-reviewed.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

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
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

test("principles-1003: a --from the door's own law refuses is NOT a traceable parent — --auto must mint or refuse, never silently levy nothing (INV-3/INV-4)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p1003-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "auto-out")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  Object.assign(env, {
    AGENTIC_OS_HOME: tmp,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevStub(tmp),
    WHL_SUPERVISOR_BIN: supervisorStub(tmp),
    // the calling agent exported a pointer the --from law refuses
    // (a space — spawnerFromArgs returns null for this value)
    WHL_FROM: "opencode:ses 123",
  })
  try {
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    // the gate decided a full rail and ledgered the promise
    assert.match(outer.stdout, /gate: review/, "the gate decided to review (jev stub keeps every lens)")
    // INV-3: "is the parent traceable" has ONE law (spawnerFromArgs).
    // A WHL_FROM value that law refuses must not count as a parent:
    // --auto then owes a minted supervisor (log beside --out) or a
    // loud refusal (exit != 0). HEAD does neither — it materializes,
    // prints "levy it with: whl run … --from …", levies NOTHING, and
    // exits 0 while the ledger row promises a full rail.
    assert.ok(
      outer.status !== 0 || existsSync(`${out}.supervisor.log`),
      "INV-3 twin: --auto with a --from/WHL_FROM value spawnerFromArgs refuses must mint the supervisor or refuse loudly — HEAD silently levies nothing and exits 0 (the PR is un-reviewed, the gate's ledger row says review)",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
