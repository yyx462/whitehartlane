// principles-5002 — the watcher must resolve the commission on the seat
// it DECLARES.
//
// The diff adds the ship watcher (src/doors/ship-supervisor.ts) — a
// detached shell that outlives the supervisor agent and reports the
// silence itself. Its own words name the seat:
//
//   "THE SEAT (principles-4004): the commission ends with the MERGE
//    stage — the merge stage writes the outcome marker into the staged
//    program dir, and the watcher waits on exactly that. The verdict
//    (prove) lands two stages earlier; waiting on it would speak before
//    the feedback map exists."
//
// But the loop it actually writes breaks on the VERDICT:
//
//   while [ ! -f "$OUT/data/review/merge.json" ]; do
//     sleep 1; i=$((i+1))
//     if [ -f "$OUT/data/review/verdict.json" ]; then break; fi
//     ...
//   done
//   if test -f "$OUT/supervisor-comment.md"; then :; elif ...; then
//     V=$(sed -n 's/.*"outcome"...' "$OUT/data/review/merge.json" ...)
//     gh pr comment "$PR" --body "ship-gate: ${V:-unknown} — the
//       supervisor did not post; the outcome is at .../merge.json"
//
// The break fires the moment the prove stage lands the verdict — TWO
// STAGES before the merge stage writes merge.json. So on the healthy
// path (the supervisor agent alive, working on its comment; the divide
// stage still running) the watcher resolves early, the backstop fires,
// and it posts a fabricated outcome to the PR:
//
//   "ship-gate: unknown — the supervisor did not post"
//
// — "unknown" because merge.json does not exist yet, and "the supervisor
// did not post" because the supervisor is still working. A false report
// on the PR's own receipt channel, on the normal path of every
// parentless --auto review.
//
// The repro drives the real door (--auto mints the real watcher), with a
// supervisor bin that stays ALIVE (the agent that owns the commission is
// working, not dead), the verdict already at the seat, and no merge.json
// (the commission is still open). It asserts the PR was NOT told an
// outcome while the outcome seat does not exist.
//
// BASE behaviour: the base door has no --auto path at all (no watcher,
// no mint) → nothing is posted → the assertion holds on BASE.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("the watcher must not report an outcome while the commission is still open", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p5002-"))
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
  // the supervisor agent is ALIVE (still working on its comment) — the
  // opposite of the dead-agent arc: nothing may be reported over its head
  const stubBin = join(tmp, "stub-opencode")
  writeFileSync(stubBin, "#!/bin/sh\nsleep 25\n")
  chmodSync(stubBin, 0o755)
  // the gh stub: every comment the flow posts is recorded
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const comments = join(tmp, "gh-comments.txt")
  const ghStub = join(bin, "gh")
  writeFileSync(ghStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(comments)}\nexit 0\n`)
  chmodSync(ghStub, 0o755)

  const out = join(tmp, "out")
  // the VERDICT landed (the prove stage ran) — but the merge stage has
  // not: the commission is still open and the outcome seat is empty
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
    const watcher = `${out}.supervisor.log.watch`
    if (!existsSync(watcher)) {
      // the base door has no --auto path at all (no watcher, no mint) —
      // nothing to judge there. The receipt channel stays silent.
      assert.ok(
        !existsSync(comments),
        `the PR was told an outcome although no watcher was minted (exit ${r.status}; stdout: ${r.stdout}; stderr: ${r.stderr})`,
      )
      return
    }
    // the watcher's beat is 1s; give it three
    for (let i = 0; i < 30 && !existsSync(comments); i++) await sleep(100)
    await sleep(500)
    assert.ok(
      !existsSync(join(out, "data", "review", "merge.json")),
      "the premise: the outcome seat (merge.json) does not exist — the merge stage has not run",
    )
    assert.ok(
      !existsSync(comments),
      `the watcher reported an outcome while the commission was still open: ${existsSync(comments) ? readFileSync(comments, "utf8").trim() : ""} — it breaks on the VERDICT seat (two stages early, contradicting its own "the commission ends with the MERGE stage ... waiting on it would speak before the feedback map exists") and posts a fabricated outcome over the live supervisor's head`,
    )
  } finally {
    spawnSync("pkill", ["-f", `${out}.supervisor.log.watch`], { encoding: "utf8" })
    spawnSync("pkill", ["-f", `${tmp}/stub-opencode`], { encoding: "utf8" })
    rmSync(tmp, { recursive: true, force: true })
  }
})
