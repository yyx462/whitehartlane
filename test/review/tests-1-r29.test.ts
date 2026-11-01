// tests-1 — the head-drift guard must see a branch that MOVED while the
// reviewer's own checkout still holds the judged sha (the push-during-review
// case). The guard's three arms, as written in templates/pr-review/hooks/merge.sh:
//
//   1. worktree HEAD  != HEAD_SHA      → refuses
//   2. for-each-ref --points-at HEAD_SHA, re-read each ref → "drifted"
//   3. gh pr view PR_NUM .headRefOid   != HEAD_SHA → refuses
//
// Arm 1 only fires when the LOCAL checkout moved. Arm 2 is VACUOUS:
// `for-each-ref --points-at X` lists exactly the refs whose CURRENT value IS X,
// so the re-read of each of them can never differ from X (the check can only
// observe a race between two git commands). Arm 3 fires only when PR_NUM is
// non-empty AND gh is installed — and the door writes PR_NUM='' whenever it
// cannot derive the number (no --pr, a merge-cmd that does not name a number,
// `gh pr list` finding nothing).
//
// The claim under test: "unreviewed bytes would ride the merge" must never
// happen. The push lands the new commit on the branch; the reviewer's
// checkout (detached at the judged sha) never moves; the PR's remote head is
// the moved sha. merge.sh must REFUSE.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("merge.sh: a branch that moved after the review must not be merged (the checkout still holds the judged sha)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-drift-push-"))
  const repo = join(tmp, "repo")
  const prog = join(tmp, "prog")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const judgedSha = git(repo, "rev-parse", "HEAD")

    // the review's own checkout keeps the judged bytes — DETACHED at the
    // judged sha (the reviewer reads the tree it judged)
    git(repo, "checkout", "-q", "--detach", judgedSha)

    // THE PUSH: the branch moves during the review (someone else pushed)
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "unreviewed")
    const movedSha = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "--detach", judgedSha) // the checkout stays put
    git(repo, "branch", "-f", "feat", movedSha) // the BRANCH moved
    assert.notEqual(git(repo, "rev-parse", "feat"), judgedSha, "the branch really moved")
    assert.equal(git(repo, "rev-parse", "HEAD"), judgedSha, "the checkout still holds the judged sha")

    // the door's own config: HEAD_BRANCH names the branch; PR_NUM is EMPTY
    // (the door writes PR_NUM='' whenever it cannot derive the number)
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    cpSync(join(TEMPLATES, "pr-review", "hooks", "merge.sh"), join(prog, "hooks", "merge.sh"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO=${JSON.stringify(repo)}`,
        `BASE_BRANCH='main'`,
        `BASE_SHA=${JSON.stringify(git(repo, "rev-parse", "main"))}`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA=${JSON.stringify(judgedSha)}`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD=${JSON.stringify(`echo merged >> ${JSON.stringify(merged)}`)}`,
        `PR_NUM=''`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { encoding: "utf8", cwd: repo })
    assert.notEqual(
      r.status,
      0,
      `the drift guard must refuse the merge on a moved branch (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
    assert.ok(
      !existsSync(merged),
      `MERGE_CMD must not run on a moved branch — unreviewed bytes would ride the merge (stderr: ${r.stderr})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("merge.sh: the guard's own ref sweep must be able to see a ref that moved off the judged sha", () => {
  // the sweep's own shape, run by hand: `for-each-ref --points-at X` lists
  // only refs whose CURRENT value IS X, so re-reading them can never differ
  // from X. The sweep can only observe a race between two git commands — it
  // can never report the drift it advertises.
  const tmp = mkdtempSync(join(tmpdir(), "aos-sweep-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const judgedSha = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "--detach", judgedSha)
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "unreviewed")
    const movedSha = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "--detach", judgedSha)
    git(repo, "branch", "-f", "feat", movedSha)

    // the sweep, verbatim from merge.sh
    const refs = git(repo, "for-each-ref", "--points-at", judgedSha, "--format=%(refname)", "refs/heads", "refs/remotes")
    const drifted: string[] = []
    for (const ref of refs.split("\n").filter(Boolean)) {
      const now = git(repo, "rev-parse", ref)
      if (now && now !== judgedSha) drifted.push(`${ref}(${now})`)
    }
    // the branch that moved is NOT among the refs --points-at the judged sha,
    // so the sweep never looks at it
    assert.ok(
      !refs.split("\n").includes("refs/heads/feat"),
      `the moved branch must not be listed by --points-at ${judgedSha} (it points elsewhere now)`,
    )
    assert.deepEqual(drifted, [], "the sweep reports nothing — it cannot see the drift it advertises")
    // the ONE question that answers it — the branch name the door already
    // writes into config.sh (HEAD_BRANCH) — DOES see it
    assert.notEqual(
      git(repo, "rev-parse", "feat"),
      judgedSha,
      "asking the branch by NAME is the question that detects the drift",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
