// principles-108 — "did the base move under the merge?" is ONE decision,
// checked in ONE arm and missing from the other.
//
// The change adds a drift guard to the merge stage's MERGE_CMD arm
// (templates/pr-review/hooks/merge.sh) with FOUR head-drift arms. The
// sibling arm — the LOCAL merge (no MERGE_CMD) — keeps the base-drift
// check that has been there since BASE:
//
//   now_base=$(git -C "$REPO" rev-parse "$BASE_BRANCH")
//   if [ "$now_base" != "$BASE_SHA" ]; then
//     echo "merge: base $BASE_BRANCH moved ... unreviewed commits inside
//            the accepted merge — re-observe the label and refuse on drift"
//
// That law is stated in the file's own words: a base BRANCH that moved
// since intake "would land unreviewed commits inside the accepted merge".
// The MERGE_CMD arm — the arm the AUTO flow ALWAYS takes (the mint
// defaults mergeCmd to `gh pr merge <n> --merge`, bin/whitehartlane:542)
// — checks the HEAD four times and the BASE never.
//
// So on the auto path (the change's headline feature) a base branch that
// moved during the review lands unreviewed commits inside the accepted
// merge, and the guard that was written for exactly that says nothing.
//
// The repro: the base branch gains a commit after the review (the ordinary
// "someone else merged to trunk while I was reviewing" state). The merge
// must refuse on base drift, exactly as the local arm does.
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

test("principles-108: the MERGE_CMD arm must refuse on BASE drift too (the local arm does — the auto path always takes MERGE_CMD)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-108-"))
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
    const baseShaAtReview = git(repo, "rev-parse", "main")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "main")
    // SOMEONE ELSE MERGED TO TRUNK WHILE THE REVIEW RAN — the base moved
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "someone-else")
    const baseShaNow = git(repo, "rev-parse", "main")
    assert.notEqual(baseShaNow, baseShaAtReview, "the base moved during the review")
    // park the checkout on the REVIEWED branch, so the head-drift arms
    // all pass and ONLY the base drift is left to be caught
    git(repo, "checkout", "-q", "feat")
    assert.equal(git(repo, "rev-parse", "HEAD"), headSha, "the checkout is at the judged head")

    // the gh stub: the PR's remote head IS the judged head (no head drift)
    const gh = join(tmp, "gh")
    writeFileSync(gh, ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"))
    chmodSync(gh, 0o755)
    writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(MERGE_HOOK, "utf8"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${baseShaAtReview}'`,
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
    assert.notEqual(
      r.status,
      0,
      `the merge must refuse on BASE drift — the base branch moved during the review, so unreviewed commits ` +
        `would land inside the accepted merge. The file's own law (the local arm, which keeps the check) says: "a ` +
        `base BRANCH that moved since intake would land unreviewed commits inside the accepted merge". The MERGE_CMD ` +
        `arm checks the HEAD four times and the BASE never — and the auto flow always takes the MERGE_CMD arm. ` +
        `The merge ran anyway: ${r.stdout.trim()} / ${r.stderr.trim()}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
