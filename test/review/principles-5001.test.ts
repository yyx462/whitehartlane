// principles-5001 — the ACCEPT must land the merge on the base BRANCH.
//
// The diff makes the gate's OWN resolution ride down on every arm
// (bin/whitehartlane: "base: gateBaseSha ?? val("base)"), so the review
// program is configured from the base SHA instead of the base REF.
//
// The diff fixed the HEAD twin in the same breath ("the BRANCH NAME, not
// the pinned sha ... with a sha in this field the question answers itself
// forever, and the guard can never fire" → review.ts:1096). The BASE twin
// was left wrong: review.ts:1089 writes `BASE_BRANCH=${shellQuote(base)}`
// — and `base` is now the gate's SHA.
//
// templates/pr-review/hooks/merge.sh reads BASE_BRANCH twice:
//   :84  now_base=$(git -C "$REPO" rev-parse "$BASE_BRANCH")
//        if [ "$now_base" != "$BASE_SHA" ]; then refuse (base drifted)
//   :89  git -C "$REPO" checkout -q "$BASE_BRANCH"
// With BASE_BRANCH = the base SHA:
//   * :84 is a tautology (rev-parse <sha> == BASE_SHA) → the base-drift
//     guard can never fire — the exact "the question answers itself
//     forever" defect the diff repaired on the head side;
//   * :89 checks out a SHA → a DETACHED HEAD → the --no-ff merge commit
//     is created on a dangling HEAD and the base BRANCH never advances:
//     the rail prints "merge: accepted — ... merged" and NOTHING merged
//     onto the branch the PR targets.
//
// The repro drives the real door (the gate ON — the default), then the
// real merge.sh, and asserts the base branch carries the accepted head.
//
// BASE behaviour: BASE_BRANCH = "main" → the checkout lands on the branch
// and the merge advances it → the assertion holds on BASE.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname
const stubOrchestrator = new URL("../../test/orchestrator-stub.mjs", repoRoot).pathname

test("the accept must advance the base BRANCH — the base drift guard must still be able to fire", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p5001-"))
  const repo = join(tmp, "repo")
  const prog = join(tmp, "prog")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  const baseSha = g("rev-parse", "main").trim()
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const headSha = g("rev-parse", "HEAD").trim()

  // the gate ON (the default — WHL_GATE unset), jev absent → the gate's
  // fail-safe full rail; a scratch orchestrator stub so the door never
  // books a real workflow (the leaked-lens receipt)
  const jevDead = join(tmp, "jev-dead")
  writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
  chmodSync(jevDead, 0o755)
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: join(tmp, "home"),
    AGENTIC_OS_ORCHESTRATOR: stubOrchestrator,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevDead,
  }
  delete (env as Record<string, string | undefined>).AGENTIC_OS_JID
  delete (env as Record<string, string | undefined>).WHL_GATE

  try {
    const door = spawnSync(
      process.execPath,
      ["--experimental-strip-types", doorPath, "review", repo, "--base", "main", "--head", "feat", "--out", prog, "--model", "p/m", "--unattended"],
      { env, encoding: "utf8", timeout: 120_000 },
    )
    assert.ok(
      existsSync(join(prog, "data", "review", "config.sh")),
      `the door must materialize the program (exit ${door.status}; stdout: ${door.stdout}; stderr: ${door.stderr})`,
    )
    const cfg = readFileSync(join(prog, "data", "review", "config.sh"), "utf8")
    const baseBranch = /^BASE_BRANCH='(.*)'$/m.exec(cfg)?.[1] ?? ""

    // the accept: the real merge hook, on the materialized program
    writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }))
    const runDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
    mkdirSync(runDir, { recursive: true })
    const merged = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: runDir, encoding: "utf8" })

    const mainNow = g("rev-parse", "main").trim()
    const landed = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", headSha, "main"], { encoding: "utf8" })
    assert.equal(
      landed.status,
      0,
      `the accept must advance the base BRANCH: main is still at ${mainNow.slice(0, 12)} (the base was ${baseSha.slice(0, 12)}) and the reviewed head ${headSha.slice(0, 12)} is NOT on it, yet merge.sh printed "accepted" and exited ${merged.status} (stdout: ${merged.stdout}; stderr: ${merged.stderr}). Cause: BASE_BRANCH=${baseBranch} is the base SHA, so merge.sh:89 checks out a SHA (a detached HEAD) and the merge commit dangles off the branch; merge.sh:84's base-drift guard is a tautology for the same reason.`,
    )
    assert.notEqual(
      baseBranch,
      baseSha,
      `BASE_BRANCH is the base SHA (${baseBranch.slice(0, 12)}) — the base-drift guard (merge.sh:84) compares rev-parse <sha> with BASE_SHA and can never fire; the head twin was fixed in the same diff (review.ts:1096), the base twin was left holding a sha`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
