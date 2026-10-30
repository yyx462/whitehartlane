// momentum-36 (repro for finding momentum-2) — INV-4 (verdicts are
// honest): the outer gate judges baseSha..headSha and ledger-rows the
// pinned headSha (review-gate.ts:117, runGate's appendLedgerRow), but
// the mint hands its levy down `--head 'HEAD'` — a MOVING ref
// (bin/whitehartlane --auto block: headRef = val("head") ?? "HEAD",
// re-derived at the mint even though the gate block above already
// resolved the same refs). The supervisor is a freshly spawned
// headless process: it resolves HEAD at whatever moment it happens to
// run. Any commit, rebase or checkout in the worktree between the
// mint and the levy makes the rail review a diff the gate never
// judged — with a roster PINNED for the old diff (the --roster
// hand-down) — and the accept then merges the PR (the merge command
// is pinned to the PR number, not the SHA). The commission must pin
// the SHA the decision was made on. Repro: drive the real bin with
// stubbed jev/supervisor, take the levy VERBATIM out of the
// supervisor's brief, and demand its --head equal the ledger row's
// headSha.
// (File named momentum-36: momentum-1..34 .test.ts belong to prior
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

// jev: ~90% sure every lens is needed → the outer gate decides review
// deterministically → the --auto block mints the supervisor
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

test("momentum-2: the minted levy must pin the head SHA the gate judged — never the moving ref HEAD (INV-4)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-m2-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
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
      WHL_JEV_BIN: jevStub(tmp),
      WHL_SUPERVISOR_BIN: supervisorStub(tmp),
    })
    // 1. the mint: outer gate (jev → review) → supervisor spawned with
    // the brief carrying the levy verbatim
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", join(tmp, "auto-out")],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    assert.ok(argv, "the supervisor stub captured its argv (run --standalone <brief>)")
    // argv.txt: line1 "run", line2 "--standalone", lines 3.. = the brief (multi-line)
    const brief = argv.trim().split("\n").slice(2).join("\n")
    const m = brief.match(/^\s*whl review .+$/m)
    assert.ok(m, "the brief carries the levy verbatim")
    const levy = m[0].trim()
    const hm = levy.match(/--head\s+('([^']*)'|\S+)/)
    assert.ok(hm, "the levy names --head")
    const headTok = hm[2] ?? hm[1]

    // 2. what the gate actually judged: the ledger row's pinned headSha
    const rows = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { headSha: string })
    assert.ok(rows.length > 0, "the outer gate wrote its ledger row")
    const row = rows[rows.length - 1]
    assert.match(row.headSha, /^[0-9a-f]{40}$/, "the outer gate ledgered a pinned headSha")

    // 3. the drift is real: the worktree moves on while the supervisor
    // is still spawning (submit-pr already returned; the human keeps
    // working — commit, rebase, or checkout, all move HEAD)
    execSync("git commit --allow-empty -qm drift", { cwd: repo })
    const drifted = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(drifted, row.headSha, "sanity: HEAD moved past the SHA the gate judged")

    // 4. THE assertion: the commission hands down the SHA it decided on
    assert.equal(
      headTok,
      row.headSha,
      `INV-4 (verdicts are honest): the minted levy pins the moving ref '${headTok}' — the supervisor resolves it at spawn time and would review ${drifted.slice(0, 12)}, a diff the gate never judged (it judged ${row.headSha.slice(0, 12)} and pinned a roster for it)`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
