// momentum-2002 — the head-drift guard DISARMS ITSELF when the named
// branch cannot be read: "the branch is gone" reads as "the branch still
// holds the judged bytes".
//
// WHAT THE CHANGE CLAIMS (templates/pr-review/hooks/merge.sh, the accept
// arm — the head-drift guard is added by THIS diff):
//
//   # NO WITNESS, NO MERGE (tests-10301): a HEAD_BRANCH that is empty
//   # means the door could not name the reviewed branch — the local arm
//   # cannot verify, so the PR's remote head becomes the ONLY witness;
//   # without a PR number there is nothing to verify against at all, and
//   # the accept refuses rather than merge a branch nobody can prove
//   # still holds the judged bytes.
//
// and the BASE arm of the SAME guard, in the SAME file, fails CLOSED on the
// very condition the head arm treats as a pass:
//
//   now_base="$(git -C "$REPO" rev-parse --verify "$BASE_BRANCH^{commit}" 2>/dev/null || true)"
//   if [ -z "$now_base" ]; then
//     echo "merge: base $BASE_BRANCH could not be read — its drift cannot be verified; refusing" >&2
//     exit 1
//   fi
//
// THE HEAD ARM, verbatim:
//
//   branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" 2>/dev/null || true)"
//   if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//     echo "merge: $HEAD_BRANCH moved ..." >&2
//     exit 1
//   fi
//
// An UNREADABLE branch yields branch_head="" — and `[ -n "" ]` is FALSE, so
// the guard compares nothing and PASSES. "The branch no longer exists" is
// silently read as "the branch still holds the judged bytes".
//
// THE PATH (realistic, reachable): the door names the branch at review time
// (review.ts branchOf() hands merge.sh HEAD_BRANCH='feat' — one branch points
// at the judged sha → a fact); between the review and the merge stage the
// branch is RENAMED or DELETED (a closed PR cleaned up, a local clone
// pruned, a force-push that recreated the work under another name, a CI
// checkout that only ever had a detached HEAD). No witness is left: the
// ref-sweep arm is vacuous BY THE DIFF'S OWN ADMISSION ("for-each-ref
// --points-at lists only refs that STILL point at the judged sha, so it could
// never observe a move"), and the PR-remote arm needs PR_NUM.
//
// THE HARM: the accept hands the merge to MERGE_CMD — which merges the PR's
// CURRENT head — with nothing at all proving that head is the bytes the
// verdict judged.
//
// The repro drives the change's OWN writer (prepareReview → the config.sh it
// writes) and the change's OWN reader (the real
// templates/pr-review/hooks/merge.sh) against a real git repo.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = join(import.meta.dirname, "..", "..")
const TEMPLATES = join(ROOT, "templates")

const git = (cwd: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

function fixtureRepo(where: string): { baseSha: string; headSha: string } {
  mkdirSync(where, { recursive: true })
  git(where, "init", "-q", "-b", "main", ".")
  git(where, "config", "user.email", "t@t.local")
  git(where, "config", "user.name", "t")
  writeFileSync(join(where, "base.ts"), "base\n")
  git(where, "add", "-A")
  git(where, "commit", "-qm", "base")
  const baseSha = git(where, "rev-parse", "main")
  git(where, "checkout", "-qb", "feat")
  writeFileSync(join(where, "pr.ts"), "pr\n")
  git(where, "add", "-A")
  git(where, "commit", "-qm", "pr")
  const headSha = git(where, "rev-parse", "feat")
  return { baseSha, headSha }
}

test("momentum-2002: a reviewed branch that CANNOT be read is not a witness — the accept must REFUSE", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2002-"))
  const prevHome = process.env.AGENTIC_OS_HOME
  process.env.AGENTIC_OS_HOME = join(tmp, "home")
  mkdirSync(process.env.AGENTIC_OS_HOME, { recursive: true })
  try {
    const repo = join(tmp, "repo")
    const { baseSha, headSha } = fixtureRepo(repo)
    const marker = join(tmp, "merged.txt")
    const prog = join(tmp, "prog")

    // the change's OWN writer: the config merge.sh will read
    const ready = prepareReview(
      {
        repo,
        base: baseSha,
        head: headSha,
        model: "p/m",
        out: prog,
        mergeCmd: `touch ${marker}`,
      },
      TEMPLATES,
    )
    assert.ok(ready.ok, ready.ok ? "" : String(ready.why))
    assert.ok(!ready.skipped, "the review must not skip")

    const config = readFileSync(join(ready.dir, "data", "review", "config.sh"), "utf8")
    assert.match(config, /HEAD_BRANCH='feat'/, `the door must name the branch: ${config}`)

    // the verdict the merge stage reads
    writeFileSync(
      join(ready.dir, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", blocked: [] }),
    )

    // THE FAULT: the reviewed branch is GONE before the merge stage runs
    // (renamed / deleted / pruned from the clone). The gate can no
    // longer read the ref it must prove.
    git(repo, "checkout", "-q", "main")
    git(repo, "branch", "-q", "-D", "feat")
    assert.equal(
      (() => {
        try {
          git(repo, "rev-parse", "--verify", "feat^{commit}")
          return "readable"
        } catch {
          return "unreadable"
        }
      })(),
      "unreadable",
      "the fixture must leave the reviewed branch unreadable",
    )

    const r = spawnSync("bash", [join(ready.dir, "hooks", "merge.sh")], {
      cwd: ready.dir,
      encoding: "utf8",
    })
    assert.ok(
      !existsSync(marker),
      `INV-4 (verdicts are honest — the merge must land exactly the bytes the verdict judged): ` +
        `the merge command RAN with NO witness at all: HEAD_BRANCH='feat' could not be read, ` +
        `so branch_head="" and the guard compared nothing; the ref-sweep arm is vacuous by the ` +
        `diff's own admission; PR_NUM is empty so there is no remote-head arm. ` +
        `MERGE_CMD merges the PR's CURRENT head — bytes no verdict judged. ` +
        `(stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
    assert.notEqual(
      r.status,
      0,
      `the accept must REFUSE when nothing proves the branch still holds the judged bytes ` +
        `(stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
    assert.match(
      `${r.stdout}${r.stderr}`,
      /cannot be read|unreviewed bytes|no witness|could not be read|refus/i,
      `the refusal must say why: ${r.stdout}${r.stderr}`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
