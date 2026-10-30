// momentum-200 — the twin window momentum-36's fix left open (INV-4,
// verdicts honest; INV-3, one site per decision). The f2bcc1f fix
// ("the mint pins the head SHA it judged") pins at the MINT: bin
// re-resolves `git rev-parse <headRef>` at the --auto block
// (bin/whitehartlane, `headPinned = execFileSync("git", ...)`) — a
// SECOND site making the "which bytes does the levy judge" decision
// that the gate already made (gateFeatures' own rev-parse,
// review-gate.ts:117, ledgered as the row's headSha by runGate).
// Between the two sites runs the jev subprocess (JEV_TIMEOUT_MS up to
// 30s; a real judge takes seconds). A ref that moves in that window —
// the author pushes a fix while submit-pr's review command runs, any
// commit lands on the branch — makes the mint pin bytes the gate
// NEVER judged and never ledgered: the row says headSha X, the pinned
// roster was drawn for X, and the levy hands `--head Y`. momentum-36's
// repro drifts AFTER the mint (the supervisor-spawn window, now
// closed); this one drifts BETWEEN the gate's features read and the
// mint's re-resolve — deterministic, no race: the jev stub itself
// commits to the branch as its side effect, sequenced strictly
// between the two rev-parses by the bin's own call order.
// (File named momentum-200: momentum-1..105 .test.ts belong to prior
// review rounds and stay untouched.)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "whitehartlane")
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
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// the stateful judge: BEFORE answering it moves the branch the gate is
// judging — exactly what a concurrent push does inside the gate→mint
// window (features read at T0, jev runs at T1, mint re-resolves at T2)
function jevStubThatMovesTheBranch(dir: string, repo: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-drift.sh")
  writeFileSync(
    p,
    `#!/bin/sh\ngit -C ${JSON.stringify(repo)} commit --allow-empty -qm gate-window-drift\necho '${JSON.stringify({ answers })}'\n`,
  )
  chmodSync(p, 0o755)
  return p
}

function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

test("momentum-200: a ref that moves between the gate's read and the mint's re-resolve still hands the levy bytes the gate never judged (INV-4/INV-3)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-m200-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    // X: the sha the gate's features will read (the branch tip BEFORE
    // the judge runs)
    const judged = execSync("git rev-parse feat^{commit}", { cwd: repo, encoding: "utf8" }).trim()
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
      WHL_JEV_BIN: jevStubThatMovesTheBranch(tmp, repo),
      WHL_SUPERVISOR_BIN: supervisorStub(tmp),
    })
    // the mint: gate features read X → jev MOVES feat to Y → ledger row
    // headSha X → the --auto block re-resolves feat → Y → levy --head Y
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--pr", "42", "--auto", "--model", "acme/strong", "--out", join(tmp, "auto-out")],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    assert.ok(argv, "the supervisor stub captured its argv (run --standalone <brief>)")
    const brief = argv.trim().split("\n").slice(2).join("\n")
    const m = brief.match(/^\s*whl review .+$/m)
    assert.ok(m, "the brief carries the levy verbatim")
    const levy = m[0].trim()
    const hm = levy.match(/--head\s+('([^']*)'|\S+)/)
    assert.ok(hm, "the levy names --head")
    const headTok = hm[2] ?? hm[1]

    // the branch really moved inside the gate→mint window
    const drifted = execSync("git rev-parse feat^{commit}", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(drifted, judged, "sanity: the jev stub moved the branch the gate was judging")

    // what the gate ledgered: the row MUST name the bytes it judged (X)
    const rows = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { headSha: string })
    assert.ok(rows.length > 0, "the outer gate wrote its ledger row")
    const row = rows[rows.length - 1]
    assert.equal(row.headSha, judged, "the gate's ledger row names the pre-drift sha it actually judged")

    // THE invariant: the commission hands down the SHA its decision
    // was made on — the mint's re-resolve is a second site deciding
    // "which bytes" (INV-3) and here it disagrees with the ledgered
    // one (INV-4): the roster pinned in the same levy was drawn for
    // `judged`, the rail will review `headTok`.
    assert.equal(
      headTok,
      row.headSha,
      `INV-4/INV-3: the gate judged and ledgered ${row.headSha.slice(0, 12)} (and pinned that row's roster), but the mint re-resolved the moving ref and handed the levy ${headTok.slice(0, 12)} — a second "which bytes" site (bin's rev-parse at the --auto block) that can disagree with the first (gateFeatures); the fix must hand down the gate's own resolved sha, not re-resolve it`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
