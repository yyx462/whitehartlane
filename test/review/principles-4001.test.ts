// principles-4001 — the head-drift guard must actually guard.
//
// merge.sh (the change's own "THE HEAD-DRIFT GUARD (momentum-902)") refuses
// to hand a MERGE_CMD over when the branch moved since the review judged it:
// "unreviewed bytes would ride the merge".
//
// But the guard re-observes the head through config.sh's HEAD_BRANCH — and
// the door writes `HEAD_BRANCH=<head>` where `head` is whatever the caller
// asked for. The change's own --auto flow asks for a SHA: the gate's
// resolution rides down verbatim ("the mint hands THIS sha down"), so
// HEAD_BRANCH IS the judged sha. `git rev-parse <sha>` answers that sha
// forever — the branch can move all it wants and the guard sees the sha it
// already judged. The second arm (the PR's remote head, "the stronger one
// when gh answers") cannot save it: PR_NUM is never written into config.sh
// by any site, so that arm is dead code.
//
// The result: on every --auto review (the path this change introduced) the
// drift guard is inert, and `gh pr merge` merges the PR's CURRENT head —
// bytes no verdict judged.
//
// The repro: materialize the program the way the --auto path does (head =
// the pinned sha), move the branch after the review judged it, and run the
// real hooks/merge.sh with an accept verdict. It must REFUSE.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("merge.sh: a head that moved since the review must not be merged", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-drift-"))
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

    // the --auto path's shape: the door is handed the JUDGED SHA (the
    // gate's own resolution rides down), not a branch name
    const ready = prepareReview(
      {
        repo,
        base: "main",
        head: judgedSha,
        model: "p/m",
        mergeCmd: `echo merged >> ${JSON.stringify(merged)}`,
        out: prog,
      },
      TEMPLATES,
    )
    assert.ok(ready.ok && !ready.skipped, `the program must materialize (${JSON.stringify(ready)})`)

    // DRIFT: the branch moves after the review judged its bytes
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "unreviewed")
    const movedSha = git(repo, "rev-parse", "HEAD")
    assert.notEqual(movedSha, judgedSha, "the branch really moved")

    // the verdict: accept, about the judged sha
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { encoding: "utf8", cwd: repo })
    assert.notEqual(r.status, 0, `the drift guard must refuse the merge (stdout: ${r.stdout}\nstderr: ${r.stderr})`)
    assert.ok(
      !existsSync(merged),
      `MERGE_CMD must not run on a moved head — unreviewed bytes would ride the merge (stderr: ${r.stderr})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
