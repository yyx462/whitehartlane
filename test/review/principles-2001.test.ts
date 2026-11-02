// THE GH PROBE MUST READ THE PR'S HEAD FROM THE REPO (the twin of
// momentum-901's merge seat).
//
// THE DECISION: "what is the PR's remote head?" — the head-drift
// guard's second witness. It lives in FOUR places in this change:
//
//   1. templates/pr-review/hooks/merge.sh:125  `gh pr view "$PR_NUM" …`
//   2. src/doors/ship-supervisor.ts:165/192     `(cd "$REPO" && gh …)`
//   3. src/doors/ship.ts (bin/whitehartlane)    `execFileSync("gh", …, { cwd: repoAbs })`
//   4. src/doors/review.ts:1088 (prOf)           `execFileSync("gh", …, { cwd: repo })`
//
// THREE of them run the probe FROM THE REPO. The one that GATES THE
// MERGE does not — and the gate's cwd is the job's run dir, which is
// NOT a git work tree (the very fact momentum-901 fixed for the merge
// command: "the gate runs in the job's run dir … so `gh pr merge` could
// not resolve the repository"). `gh` resolves its repository from the
// git work tree of its CWD, so outside one it fails:
//
//   $ cd /tmp && gh pr view 1 --json headRefOid
//   failed to run git: fatal: not a git repository (or any of the
//   parent directories): .git
//
// The arm is fail-closed by design ("the merge would land bytes no
// verdict judged; refusing"), so the failure lands as a REFUSAL that
// asserts a false fact about the PR — and the ship gate's accept never
// merges. INV-3: the decision lives in more than one place; the odd one
// out is wrong.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MERGE_SH = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "merge.sh")

const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// a gh stub that models the REAL gh contract: the repository comes from
// the git work tree of the CWD; outside one, gh fails exactly like the
// binary does ("failed to run git: fatal: not a git repository").
const ghStub = (dir: string, headFile: string): string => {
  const p = join(dir, "gh")
  writeFileSync(
    p,
    [
      "#!/bin/sh",
      'top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "failed to run git: fatal: not a git repository (or any of the parent directories): .git" >&2; exit 1; }',
      'case "$1 $2" in',
      `  "pr view") cat ${sq(headFile)} ;;`,
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  )
  chmodSync(p, 0o755)
  return p
}

test("merge.sh reads the PR's remote head FROM THE REPO — the gate's cwd is not a git work tree", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ghseat-"))
  const repo = join(tmp, "repo")
  const runDir = join(tmp, "run") // the job's run dir: NOT a git work tree
  const bin = join(tmp, "bin")
  try {
    // ---- the reviewed repo
    mkdirSync(repo, { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "a.txt"), "base\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    const baseSha = g("rev-parse", "main").trim()
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "a.txt"), "head\n")
    g("add", "-A")
    g("commit", "-qm", "head")
    const headSha = g("rev-parse", "HEAD").trim()

    // ---- the gate's program dir (what the orchestrator hands the stage)
    mkdirSync(join(runDir, "hooks"), { recursive: true })
    mkdirSync(join(runDir, "data", "review"), { recursive: true })
    writeFileSync(join(runDir, "hooks", "merge.sh"), readFileSync(MERGE_SH, "utf8"))
    writeFileSync(join(runDir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))
    const merged = join(tmp, "merged.txt")
    const headFile = join(tmp, "pr-head.txt")
    writeFileSync(headFile, `${headSha}\n`)
    mkdirSync(bin, { recursive: true })
    ghStub(bin, headFile)
    writeFileSync(
      join(runDir, "data", "review", "config.sh"),
      [
        `REPO=${sq(repo)}`,
        `BASE_BRANCH=${sq("main")}`,
        `BASE_SHA=${sq(baseSha)}`,
        `HEAD_BRANCH=${sq("feat")}`,
        `HEAD_SHA=${sq(headSha)}`,
        `TITLE=${sq("t")}`,
        `AUTHOR=''`,
        `MERGE_CMD=${sq(`echo merged >> ${merged}`)}`,
        `PR_NUM=${sq("42")}`,
        `STAGED_DIR=${sq(runDir)}`,
        `STOP_HISTORY=''`,
        `STOP_CFG=''`,
        "",
      ].join("\n"),
    )

    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }

    // ---- the CONTROL: the same script, run with the repo as its cwd
    // (what every other gh call in this change does) — it merges.
    const control = spawnSync("bash", [join(runDir, "hooks", "merge.sh")], { cwd: repo, env, encoding: "utf8" })
    assert.equal(control.status, 0, `control: the accept must merge from the repo (stderr: ${control.stderr})`)
    assert.ok(readFileSync(merged, "utf8").includes("merged"), "control: the merge command ran")

    // ---- the REAL seat: the orchestrator runs the gate with cwd = the
    // job's run dir (src/engines/orchestrator.ts execGate:
    // `execSync(step.check!, { cwd: input.taskDir })`), and the run dir
    // is not a git work tree.
    rmSync(merged, { force: true })
    const inRunDir = spawnSync("bash", [join(runDir, "hooks", "merge.sh")], { cwd: runDir, env, encoding: "utf8" })
    assert.equal(
      inRunDir.status,
      0,
      `INV-3: the gh probe must read the PR's head FROM THE REPO (the gate's cwd is the run dir, not a git work tree — gh cannot resolve a repo there, so the arm refuses an honest accept). stderr: ${inRunDir.stderr}`,
    )
    assert.ok(readFileSync(merged, "utf8").includes("merged"), "the accept must merge")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
