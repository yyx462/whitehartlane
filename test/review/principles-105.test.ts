// principles-105 — "will the merged bytes be the bytes the verdict judged?"
// is ONE decision, and the drift guard answers it FOUR times.
//
// The change adds a drift guard to the merge stage
// (templates/pr-review/hooks/merge.sh, the MERGE_CMD arm). Its stated
// purpose (the guard's own words): "a push during the review would land
// bytes no verdict judged". Four arms answer that one question:
//
//   arm 1  HEAD_BRANCH's tip            vs judged_head
//   arm 2  the REPO's checked-out HEAD  vs judged_head   <-- a DIFFERENT question
//   arm 3  every ref pointing at judged_head, re-read
//   arm 4  the PR's remote head (gh)    vs judged_head
//
// Arm 2 is the odd one out. "The reviewed tree" is a DEFINED thing in
// this very template: intake.sh checks the judged head out into a
// DETACHED worktree at $prog/data/review/head (intake.sh:36) — that tree
// is pinned at HEAD_SHA and cannot move. Arm 2 does not look at that tree
// at all; it reads `git -C "$REPO" rev-parse HEAD` — the USER'S OWN
// WORKING COPY of the repo (a different tree, on whatever branch the
// operator last checked out), and then calls it "the reviewed tree".
//
// So on the ordinary workstation state — the PR is pushed, the operator
// switched their checkout back to the trunk — arm 2 refuses an accept
// whose bytes the verdict DID judge, with a message that is factually
// false ("the reviewed tree moved"). The bytes that ride the merge are
// the PR's remote head, which arm 4 proves is still the judged sha.
//
// The repro: a repo whose checkout is parked on `main` while the judged
// head is `feat`, the PR's remote head answering the judged sha (arm 4
// passes). The merge must run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")
const MERGE_HOOK = join(TEMPLATES, "pr-review", "hooks", "merge.sh")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("principles-105: the drift guard must not kill an accept whose bytes the verdict judged (the user's checkout is not the reviewed tree)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-105-"))
  try {
    const prog = join(tmp, "prog")
    const staged = join(tmp, "staged")
    const repo = join(tmp, "repo")
    const merged = join(tmp, "merged.txt")
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    mkdirSync(join(staged, "data", "review"), { recursive: true })
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")
    // the ordinary workstation state: the PR is pushed and the operator's
    // checkout went back to the trunk. The reviewed bytes live on `feat`;
    // the PR's remote head still answers the judged sha.
    git(repo, "checkout", "-q", "main")
    const gh = join(tmp, "gh")
    writeFileSync(gh, ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"))
    chmodSync(gh, 0o755)
    writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(MERGE_HOOK, "utf8"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${git(repo, "rev-parse", "main")}'`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA='${headSha}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD='echo merged >> ${merged}'`,
        `PR_NUM='42'`,
        `STAGED_DIR='${staged}'`,
        "",
      ].join("\n"),
    )
    writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }))

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
      cwd: prog,
      encoding: "utf8",
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ""}` },
    })
    assert.equal(
      r.status,
      0,
      `the accept must merge — nothing the verdict judged has moved (the branch tip is the judged sha, and the PR's remote head answers the judged sha). The guard refused: ${r.stderr.trim()}`,
    )
    assert.ok(
      readFileSync(merged, "utf8").includes("merged"),
      "the merge command must have run",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
