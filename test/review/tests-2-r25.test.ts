// tests-2 — the minted supervisor's levy RE-DECIDES the gate. The
// --auto contract (bin/whitehartlane:431-433): "The gate has decided
// above; the only question left is WHO hears the verdict." But the
// levy handed to the supervisor (bin:467) carries no roster, no audit
// flag, no decision marker — so the supervisor's `whl review` runs the
// gate AGAIN (a fresh, stochastic jev draw and a fresh dropout roll).
// When the second evaluation says skip, the levy returns before
// materializing anything: no rail, no verdict.json — while the mint
// printed "verdict: will land at …". The PR's review silently never
// happens. Repro is deterministic: a stateful jev stub (call #1 →
// review, call #2 → all-low), a pre-decayed ledger (5 green-labeled
// skips → audit rate 0.25) and Math.random pinned at 0.99 via
// NODE_OPTIONS so the second gate's skip always stands unaudited.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")

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

// stateful jev stub: invocation 1 → all 0.9 (review); ≥2 → all 0.05 (skip)
function jevStubStateful(dir: string): string {
  const answers = (n: number) => JSON.stringify({ answers: Object.fromEntries(["principles", "tests", "momentum", "questions"].map((l) => [`l_${l}`, { type: "noul", noul: n }])) })
  const p = join(dir, "jev-stateful.sh")
  const count = join(dir, "jev-count")
  writeFileSync(
    p,
    `#!/bin/sh
N=$(cat ${JSON.stringify(count)} 2>/dev/null || echo 0)
N=$((N + 1))
echo $N > ${JSON.stringify(count)}
if [ "$N" -le 1 ]; then echo '${answers(0.9)}'; else echo '${answers(0.05)}'; fi
`,
  )
  chmodSync(p, 0o755)
  return p
}

// seed the ledger with green-labeled skips so the class's audit rate is 0.25
function seedGreens(home: string, n: number): void {
  for (let i = 1; i <= n; i++) {
    const vd = join(home, "sessions", "seed", "jobs", `j${i}`, "run", "data", "review")
    mkdirSync(vd, { recursive: true })
    writeFileSync(join(vd, "verdict.json"), JSON.stringify({ head: `g${i}`, blocked: [] }))
    // verdictRedsByHeadSha keys on the verdict's head; the row's headSha must match
  }
  const rows = Array.from({ length: n }, (_, i) =>
    JSON.stringify({ ts: "t", repo: "r", head: `g${i + 1}`, headSha: `g${i + 1}`, klass: "code_small", files: 1, churn: 1, hot: [], ps: {}, roster: [], action: "skip", audit: false }),
  )
  writeFileSync(join(home, "gate.jsonl"), rows.join("\n") + "\n")
}

test("minted supervisor's levy delivers the review the gate already decided", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-auto-redecide-"))
  const home = join(tmp, "home")
  mkdirSync(home, { recursive: true })
  const repo = fixtureRepo(join(tmp, "repo"))
  const stub = jevStubStateful(tmp)
  seedGreens(home, 5)
  // pin the dropout roll at 0.99 (above the 0.25 rate) in every child node process
  const seed = join(tmp, "seed-random.cjs")
  writeFileSync(seed, "Math.random = () => 0.99\n")
  // the orchestrator door seam — its marker is the proof a levy happened
  // (the seam spawns it as NODE — a .mjs stub, never sh)
  const orch = join(tmp, "orch-door.mjs")
  const orchMarker = join(tmp, "orchestrator-ran.txt")
  writeFileSync(orch, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(orchMarker)}, process.argv.slice(2).join(' ') + '\\n')\n`)
  // the supervisor stub: records the brief (argv[2])
  const supBin = join(tmp, "stub-supervisor")
  const briefPath = join(tmp, "brief.txt")
  writeFileSync(supBin, `#!/bin/sh\nprintf '%s' "$3" > ${JSON.stringify(briefPath)}\n`)
  chmodSync(supBin, 0o755)
  // `whl` on PATH for the supervisor's levy — the real installation
  const binDir = join(tmp, "bin")
  mkdirSync(binDir)
  writeFileSync(join(binDir, "whl"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(HEAD, "bin", "whitehartlane"))} "$@"\n`)
  chmodSync(join(binDir, "whl"), 0o755)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    AGENTIC_OS_NOTIFY: "0",
    WHL_JEV_BIN: stub,
    AGENTIC_OS_ORCHESTRATOR: orch,
    WHL_SUPERVISOR_BIN: supBin,
    NODE_OPTIONS: `--require ${JSON.stringify(seed)}`,
    PATH: `${binDir}:${process.env.PATH}`,
  }
  delete env.WHL_FROM
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  try {
    const mint = spawnSync(
      process.execPath,
      [join(HEAD, "bin", "whitehartlane"), "review", repo, "--base", "main", "--head", "feat", "--pr", "42", "--auto", "--model", "p/m", "--out", join(tmp, "out")],
      { env, encoding: "utf8", timeout: 60_000 },
    )
    assert.equal(mint.status, 0, `mint exited ${mint.status}: ${mint.stderr}`)
    // the mint promised a verdict
    assert.match(mint.stdout, /verdict: will land at/)
    // the supervisor was minted with the levy in its brief
    let brief = ""
    for (let i = 0; i < 100 && !brief; i++) {
      if (existsSync(briefPath)) brief = readFileSync(briefPath, "utf8")
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
    assert.ok(brief, "the supervisor was minted and received its brief")
    const levy = brief.split("\n").map((l) => l.trim()).find((l) => l.startsWith("whl review"))
    assert.ok(levy, `the brief carries the levy command (got: ${brief.slice(0, 300)})`)
    // the supervisor runs the levy verbatim in a shell — do exactly that
    const levyRun = spawnSync("sh", ["-c", levy], { env, encoding: "utf8", timeout: 60_000 })
    // THE invariant: the gate decided REVIEW above (that is why the
    // supervisor exists). The levy must deliver that review — it may
    // not re-run the gate, re-draw jev, and levy NOTHING while the PR
    // waits for a verdict that will never land. The orchestrator stub
    // is spawned DETACHED — poll for its marker (a one-shot
    // existsSync races the spawn).
    let levied = existsSync(orchMarker)
    for (let i = 0; i < 60 && !levied; i++) {
      await new Promise((r) => setTimeout(r, 50))
      levied = existsSync(orchMarker)
    }
    assert.ok(
      levied,
      `the levy minted for an already-decided review must levy the rail — instead it re-decided and spawned nothing (levy exit ${levyRun.status}, stdout: ${levyRun.stdout.slice(0, 300)})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
