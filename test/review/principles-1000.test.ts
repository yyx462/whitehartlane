// principles-1000 (P0, INV-3 twin): the --auto mint pre-creates the
// levy's --out dir (bin: mkdirSync(out) + supervisor.log), and the door
// the levy targets refuses any existing --out that is not a
// materialized review program (review.ts "--out ... exists and is not
// a materialized review program — refusing to replace it"). The same
// decision — "is this --out admissible" — made in two places, and the
// two disagree: EVERY parentless auto review mints a supervisor whose
// levy dies at its own door. No rail, no verdict.json, no PR comment,
// while the mint printed "verdict: will land at ...". Reproduced
// end-to-end: run the real mint with stubbed jev/supervisor, take the
// levy VERBATIM out of the supervisor's brief, run it — it is refused.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

// a jev stub that says "every lens is needed" → the outer gate decides
// review → the --auto block mints the supervisor
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

// a supervisor stub: records its argv (run / --standalone / brief)
function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("principles-1000: the minted levy must be admissible at its own door (INV-3: one --out decision)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p1000-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "auto-out")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_FROM
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
  })
  try {
    // 1. the real mint: parentless --auto (no WHL_FROM, no --from)
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)
    assert.match(outer.stdout, /verdict: will land at/, "the mint promises a verdict")

    // FIXED shape (adopted with the fix): the mint must NOT pre-create
    // --out — the door's replace-guard refuses a non-program dir, so a
    // pre-created out dir was dead-on-arrival for EVERY parentless auto
    // review. The supervisor's log lives BESIDE the run dir.
    assert.ok(!existsSync(out), "the mint must not pre-create the levy's --out dir (the door would refuse it)")
    assert.ok(existsSync(`${out}.supervisor.log`), "the supervisor's log lives beside the run dir, never inside it")

    // 2. the supervisor's commission: take the levy VERBATIM from the brief
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    const m = argv.match(/^\s*whl review .+$/m)
    assert.ok(m, `the brief carries the levy verbatim (argv: ${argv.slice(0, 200)})`)
    const nodeWhl = `${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(BIN)}`
    const levyCmd = m[0].replace(/^(\s*)whl /, `$1${nodeWhl} `).trim()

    // 3. run the levy exactly as the supervisor would — the door it targets
    // (adopted with the fix: the orchestrator seam stub, so the inner
    // levy can BOOK its job in the sandboxed home instead of failing at
    // the runner door. The seam spawns the stub as NODE — a .mjs stub,
    // never sh)
    const orch = join(tmp, "orch-door.mjs")
    writeFileSync(orch, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(tmp, "orchestrator-ran.txt"))}, process.argv.slice(2).join(' ') + '\\n')\n`)
    const inner = spawnSync("sh", ["-c", levyCmd], { encoding: "utf8", env: { ...env, AGENTIC_OS_ORCHESTRATOR: orch }, cwd: tmp, timeout: 120_000 })
    assert.ok(
      !/refusing to replace it/.test(inner.stderr),
      `INV-3 twin: the --auto mint pre-creates --out; the door's replace-guard refuses it — the auto ship gate's normal path can never levy (inner exit ${inner.status}, stderr: ${inner.stderr.split("\n").slice(0, 3).join(" | ")})`,
    )
    assert.equal(inner.status, 0, "the minted levy must run (the supervisor is commissioned to hear it finish)")
    assert.ok(existsSync(join(out, "workflow.toml")), "the levy materialized its program in the out dir")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
