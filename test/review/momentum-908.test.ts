// momentum-908 — the watcher that outlives the agent must carry the
// OUTCOME, not only the silence.
//
// This change adds the watcher (src/doors/ship-supervisor.ts:245-320):
// a detached shell that runs the supervisor agent and polls the verdict
// seat itself. Its own words:
//
//   "mint the owner: a detached WATCHER that runs the supervisor agent
//    and outlives it (2026-10-30, momentum-905). 'pid N owns the review'
//    is a claim about a LIVE process: an agent that dies at once (no
//    auth, no model, a bad flag) left the PR unreviewed AND unreported,
//    because the 2h timeout lived INSIDE the agent. The watcher is the
//    watch: it runs the agent, waits for the verdict at the seat the
//    door PROMISED … and reports the silence itself when the deadline
//    passes — so the commission is watched even when its agent is not."
//
// and the brief's law (ship-supervisor.ts:26): "the PR is NEVER left
// silent" (step 4/5: post ONE comment naming the outcome).
//
// The watcher script (ship-supervisor.ts:277-296) posts a comment on
// ONE path only — the deadline branch:
//
//   while [ ! -f "$OUT/data/review/verdict.json" ]; do
//     sleep 15; i=$((i+1))
//     if [ "$i" -ge 480 ]; then … gh pr comment "$PR" … exit 3; fi
//   done
//   exit 0
//
// The SUCCESS branch — the verdict LANDED — exits 0 in silence. The
// verdict comment is the AGENT's job (the brief's step 5). So the arc
// this change exists to close is still open:
//
//   the agent dies (the documented arc: "the first live supervisor died
//   exactly this way and PR #259 went silent") WHILE the levy runs on —
//   the levy is DETACHED (bin/whitehartlane:658 spawnRunner → detached),
//   so the review completes and prove.sh writes the verdict → the
//   watcher sees the seat resolve → the watcher exits 0, SILENT → the
//   agent that would have posted the comment is dead → the PR hears
//   NOTHING about a review that finished (and may have merged).
//
// The watcher is the only thing alive to carry the outcome, and it
// carries nothing.
//
// The repro drives the REAL door's --auto path (the door writes and
// spawns the real watcher script) with a stub supervisor bin that exits
// at once (a dead agent), the verdict already landed at the seat, and a
// gh stub that records every comment. It asserts the PR heard it.
//
// BASE behaviour: the base door has no --auto path at all (no watcher,
// no mint) → the gh stub records nothing → the assertion fails on BASE
// too, and the diff DOES touch bin/whitehartlane → the prove gate
// classifies this as an incomplete-fix.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("the watcher must carry the verdict to the PR even when the agent is dead", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom908-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" })
  for (const c of [
    ["init", "-q", "-b", "main", "."],
    ["config", "user.email", "t@t.local"],
    ["config", "user.name", "t"],
  ]) g(...c)
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add", "-A")
  g("commit", "-qm", "feat")

  const orch = join(tmp, "orchestrator-stub.mjs")
  writeFileSync(orch, "process.exit(0)\n")
  const jevDead = join(tmp, "jev-dead")
  writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
  chmodSync(jevDead, 0o755)
  // a DEAD supervisor agent: the stub bin exits at once (no auth, no
  // model — the arc momentum-905 names)
  const stubBin = join(tmp, "stub-opencode")
  writeFileSync(stubBin, "#!/bin/sh\nexit 0\n")
  chmodSync(stubBin, 0o755)
  // the gh stub: every comment the flow posts is recorded
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const comments = join(tmp, "gh-comments.txt")
  const ghStub = join(bin, "gh")
  writeFileSync(ghStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(comments)}\nexit 0\n`)
  chmodSync(ghStub, 0o755)

  const out = join(tmp, "out")
  // the verdict LANDED at the seat the door promised (the levy is
  // detached — it completes even when the agent dies)
  mkdirSync(join(out, "data", "review"), { recursive: true })
  writeFileSync(
    join(out, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "reject", head: "a".repeat(40), blocked: [{ id: "m-1", severity: "P1", claim: "c" }] }),
  )

  const env = {
    ...process.env,
    AGENTIC_OS_HOME: join(tmp, "home"),
    AGENTIC_OS_ORCHESTRATOR: orch,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevDead,
    WHL_SUPERVISOR_BIN: stubBin,
    OPENCODE_SESSION_ID: "",
    HERDR_ENV: "",
    HERDR_PANE_ID: "",
    WHL_FROM: "",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  }
  delete (env as Record<string, string | undefined>).AGENTIC_OS_JID

  try {
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", doorPath, "review", repo, "--pr", "42", "--auto", "--model", "p/m", "--base", "main", "--head", "feat", "--out", out],
      { env, encoding: "utf8", timeout: 60_000, cwd: tmp },
    )
    assert.ok(
      existsSync(`${out}.supervisor.log.watch`),
      `the --auto path must mint the watcher (exit ${r.status}; stdout: ${r.stdout})`,
    )
    // the watcher polls the seat (it is already there) — give it its beat
    for (let i = 0; i < 15 && !existsSync(comments); i++) await sleep(100)
    await sleep(300)
    assert.ok(
      existsSync(comments),
      `the PR must hear the outcome: the watcher saw the verdict land and exited SILENT (no gh pr comment) — the agent that would have posted it is dead, so the commission's one delivery never happens and the PR goes silent exactly as PR #259 did`,
    )
    assert.match(readFileSync(comments, "utf8"), /pr comment 42/)
  } finally {
    spawnSync("pkill", ["-f", `${out}.supervisor.log.watch`], { encoding: "utf8" })
    rmSync(tmp, { recursive: true, force: true })
  }
})
