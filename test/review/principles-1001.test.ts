// principles-1001 (P1, INV-3): the parentless --auto flow makes the
// review-or-skip decision TWICE for one commission. The outer process
// runs the gate (ledger row #1, action "review"), then mints a
// supervisor whose levy is a plain `whl review ... --unattended` — no
// roster pin, no gate bypass — so the inner process runs the SAME gate
// again (ledger row #2) and can flip the decision (jev is a
// probabilistic judgment; asking it twice is the bug). Receipt: two
// ledger rows for one headSha, the second DISAGREEING with the first
// (outer: review → inner: skip). On a decayed class the inner skip
// stands → nothing levies → no verdict.json → the supervisor reads a
// file that will never exist and the PR never hears.
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

// a counting jev stub: the FIRST run says review (0.9 ×4), every later
// run says skip (0.01 ×4) — the same question asked twice, answered
// differently, exactly as a probabilistic judge can
function jevStubCounting(dir: string): string {
  const answers = (n: number) => {
    const a: Record<string, { type: string; noul: number }> = {}
    for (const l of ["principles", "tests", "momentum", "questions"]) a[`l_${l}`] = { type: "noul", noul: n }
    return JSON.stringify({ answers: a })
  }
  const p = join(dir, "jev-count.sh")
  writeFileSync(p, `#!/bin/sh
n=$(cat ${join(dir, "cnt")} 2>/dev/null || echo 0)
echo $((n+1)) > ${join(dir, "cnt")}
if [ "$n" -ge 1 ]; then echo '${answers(0.01)}'; else echo '${answers(0.9)}'; fi
`)
  chmodSync(p, 0o755)
  return p
}

function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

// the orchestrator door seam (adopted with the fix): the minted levy
// gets PAST the door now — without the stub it books a REAL workflow
// in the sandboxed home (spawning actual lens workers, waking sessions).
// The seam spawns the stub as NODE: a .mjs stub, never sh
function orchestratorStub(dir: string): string {
  const p = join(dir, "orch-door.mjs")
  writeFileSync(p, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(dir, "orchestrator-ran.txt"))}, process.argv.slice(2).join(' ') + '\\n')\n`)
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("principles-1001: one commission, one gate decision (INV-3: the minted levy must carry the outer gate's verdict)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p1001-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "auto-out")
  const ledger = join(tmp, "gate.jsonl")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_FROM
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  Object.assign(env, {
    AGENTIC_OS_HOME: tmp,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: ledger,
    WHL_JEV_BIN: jevStubCounting(tmp),
    WHL_SUPERVISOR_BIN: supervisorStub(tmp),
    AGENTIC_OS_ORCHESTRATOR: orchestratorStub(tmp),
  })
  try {
    // 1. the mint: outer gate (jev call #1 → review) → supervisor spawned
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)

    // 2. the supervisor runs the levy verbatim → the INNER gate (jev
    // call #2 → skip) makes the same decision again
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    const m = argv.match(/^\s*\S+\s+review\s.+$/m)
    assert.ok(m, "the brief carries the levy verbatim")
    const nodeWhl = `${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(BIN)}`
    const levyCmd = m[0].replace(/^(\s*)whl /, `$1${nodeWhl} `).trim()
    spawnSync("sh", ["-c", levyCmd], { encoding: "utf8", env, cwd: tmp, timeout: 120_000 })

    // 3. the receipt: the ledger for this one commission
    const headSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    const rows = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => r.headSha === headSha)
    assert.equal(
      rows.length,
      1,
      `INV-3: the review-or-skip decision for one auto commission is made ONCE — the minted levy re-ran the gate and wrote a second row (${rows.map((r: { action: string }) => r.action).join(", ")})`,
    )
    assert.equal(
      rows[rows.length - 1].action,
      "review",
      "the second seat must not flip the first: the outer gate decided review, the minted levy's own gate decided skip",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
