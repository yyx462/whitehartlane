// principles-3000 (P0, INV-6 one wake per commission / INV-3 one function
// per decision): the ship supervisor's commissioned watch polls a path
// the rail never writes. The brief's ONLY concrete wait — its foreground
// spell `until [ -f "$V" ]` with V = <runDir>/data/review/verdict.json,
// runDir being the levy's --out dir — watches the STAGED PROGRAM dir,
// but the verdict is written at the JOB's staged run dir:
//   - spawnRunner hands the orchestrator job.dir (src/adapters/levy.ts,
//     spawn(.., [.., door, job.dir])), job.dir = jobs/<jid>/run
//     (src/adapters/store.ts jobRunDir);
//   - hooks run with cwd = taskDir (src/doors/hooks.ts runHook:
//     execSync(cmd, { cwd: taskDir }));
//   - prove.sh resolves prog = dirname($0)/.. = that run dir and writes
//     $prog/data/review/verdict.json (templates/pr-review/hooks/prove.sh
//     lines 18-20 and 190).
// Every verdict reader in src/ scans jobs/<jid>/run/data/review/
// verdict.json (review-gate.ts:99,166; ship.ts:41; run.ts:219); the
// spell is the lone dissenter polling the --out dir, which NOTHING ever
// writes. On every parentless --auto review the minted hearer polls a
// dead path for 7200s and then posts a false "review timed out" — the
// verdict reaches the PR only if the agent disobeys the spell. The
// receipt the brief itself cites ("the first live supervisor died
// exactly this way and PR #259 went silent") is this shape one step
// worse.
//
// Reproduced end-to-end like principles-1000: run the real mint with
// stubbed jev/supervisor, take the levy VERBATIM out of the brief, run
// it against an orchestrator door stub that models the rail's one
// relevant fact — it is handed the job's run dir and (as prove.sh does)
// writes the verdict THERE — then check every path the brief's spell
// can poll.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// jev says "every lens is needed" → the outer gate decides review →
// the --auto block mints the supervisor
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

// the supervisor stub: records argv (run / --standalone / brief)
function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("principles-3000: the supervisor's foreground wait must poll a path the rail writes (INV-6: the commissioned hearer hears the finish)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p3000-"))
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
    // 1. the real mint: parentless --auto — the rare path, no parent anywhere
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)

    // 2. the supervisor's commission: the brief (argv line 3)
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    assert.ok(argv, "the supervisor stub captured its brief")
    const brief = argv.trim().split("\n").slice(2).join("\n")
    // the brief's foreground wait spell polls exactly the staged out dir
    const spell = brief.split("\n").find((l) => l.includes("until [ -f"))
    assert.ok(spell, "the brief carries its foreground wait spell")
    assert.ok(
      spell.includes(join(out, "data", "review", "verdict.json")),
      `the spell's polled path is the staged --out dir's verdict path (spell: ${spell.slice(0, 160)}…)`,
    )

    // 3. run the levy VERBATIM, as the supervisor would — with an
    // orchestrator door stub that models the rail's one relevant fact:
    // prove.sh writes the verdict at $prog/data/review/verdict.json
    // where $prog is the JOB's run dir the door was handed
    const orch = join(tmp, "orch-door.mjs")
    const marker = join(tmp, "rail-finished.txt")
    writeFileSync(
      orch,
      [
        `import { mkdirSync, writeFileSync } from "node:fs"`,
        `import { join } from "node:path"`,
        `const jobDir = process.argv[2]`,
        `mkdirSync(join(jobDir, "data", "review"), { recursive: true })`,
        `writeFileSync(join(jobDir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "reject", head: "f".repeat(40), blocked: [{ id: "x-1", severity: "P1", claim: "c" }] }, null, 2) + "\\n")`,
        `writeFileSync(${JSON.stringify(marker)}, jobDir + "\\n")`,
      ].join("\n"),
    )
    const m = brief.match(/^\s*\S+\s+review\s.+$/m)
    assert.ok(m, "the brief carries the levy verbatim")
    const nodeWhl = `${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(BIN)}`
    const levyCmd = m[0].replace(/^(\s*)whl /, `$1${nodeWhl} `).trim()
    const inner = spawnSync("sh", ["-c", levyCmd], { encoding: "utf8", env: { ...env, AGENTIC_OS_ORCHESTRATOR: orch }, cwd: tmp, timeout: 120_000 })
    assert.equal(inner.status, 0, `the minted levy must run (stderr: ${inner.stderr.split("\n").slice(0, 3).join(" | ")})`)

    // 4. the rail finished: the verdict EXISTS at the job's run dir
    let railDir = ""
    for (let i = 0; i < 200 && !railDir; i++) {
      await sleep(50)
      if (existsSync(marker)) railDir = readFileSync(marker, "utf8").trim()
    }
    assert.ok(railDir, "the rail (orchestrator door stub) ran and wrote its verdict")
    const jobVerdict = join(railDir, "data", "review", "verdict.json")
    assert.ok(existsSync(jobVerdict), `the verdict landed at the JOB's run dir, where prove.sh writes it (${jobVerdict})`)
    // and the staged out dir is the SOURCE the job copied from — it is
    // NOT the run dir (jobs/<jid>/run is, by book→createJob→stageRun)
    assert.ok(!railDir.startsWith(out), "the job's run dir is the staged copy under jobs/<jid>/run, not the --out dir")

    // 5. THE FINDING: the path the spell polls for up to 7200s must
    // carry the verdict once the rail has finished — on HEAD it never
    // does: nothing in src/ or templates/ ever writes a verdict into
    // the --out dir (grep: the only writer is prove.sh at $prog). The
    // commissioned hearer waits two hours on a dead path and then
    // reports a false timeout — the finish is unheard (INV-6).
    assert.ok(
      existsSync(join(out, "data", "review", "verdict.json")),
      `INV-6: the supervisor's spell polls ${join(out, "data", "review", "verdict.json")} for 480×15s, but the rail wrote its verdict at ${jobVerdict} — the polled path never receives it; every parentless --auto review ends in a false 2h timeout with the verdict unheard (fix: the spell must watch where the verdict lands — the job's run dir — or the verdict must land where the spell polls)`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
