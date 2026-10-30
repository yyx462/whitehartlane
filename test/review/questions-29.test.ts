// questions-29 (questions lens, Q2/Q4) — THE HEAD-DRIFT GUARD'S WORKTREE
// ARM REFUSES AN ACCEPT WHOSE BYTES EVERY PROOF CONFIRMS.
//
// This diff adds the guard to templates/pr-review/hooks/merge.sh (the
// MERGE_CMD arm). Its arms:
//   1. the BRANCH NAME's tip must still be the judged sha
//   2. the repo's own HEAD (the WORKTREE) must be the judged sha
//   3. the PR's remote head (gh) must be the judged sha
//
// Arm 2 compares the REPO's checkout — the USER's working tree, which the
// review never judged (the review judged base..HEAD_SHA, a commit). The
// review's bytes are identified by HEAD_SHA; the merge command merges the
// PR's remote head, and arm 3 proves that head IS the judged sha. The
// local tree's bytes can never ride the merge, so arm 2's own reason
// ("unreviewed bytes would ride the merge") is FALSE, and a user who
// switched branches back to the trunk (the ordinary state of a workstation
// that pushed the PR) kills an accept that arms 1 and 3 both prove.
//
// The arm was added by THIS diff; before it, the local arm merged
// unconditionally.
//
// The repro: a real repo, the judged head on branch `feat` (still
// pointing at it), the PR's remote head answering the judged sha (gh),
// and the checkout parked on `main`. The merge must run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MERGE_HOOK = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "merge.sh")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("questions-29: the accept must merge when the branch AND the PR's remote head are the judged sha (the user's checkout is not the reviewed tree)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q3-worktree-"))
  const prog = join(tmp, "prog")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    const baseSha = git(repo, "rev-parse", "main")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")
    // the ordinary workstation state: the PR is pushed, the checkout went
    // back to the trunk. The reviewed bytes are on `feat`.
    git(repo, "checkout", "-q", "main")
    assert.equal(git(repo, "rev-parse", "feat"), headSha, "the branch still points at the judged sha")

    // a gh stub: the PR's remote head IS the judged head
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"),
    )
    chmodSync(gh, 0o755)

    writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(MERGE_HOOK, "utf8"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${baseSha}'`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA='${headSha}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD='echo merged >> ${merged}'`,
        `PR_NUM='42'`,
        `STAGED_DIR='${prog}'`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
      cwd: prog,
      encoding: "utf8",
      env: { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ""}` },
    })
    assert.ok(
      existsSync(merged),
      `the accept must merge: the branch feat still points at the judged sha, the PR's remote head IS the judged sha (gh proved it), and the repo's own checkout — the USER's tree, not the reviewed one — is parked on main. The merge must not ride on it (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
