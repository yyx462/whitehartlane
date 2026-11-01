// tests-20002 (tests lens) — THE HEAD-DRIFT GUARD HAS NO "CANNOT
// VERIFY" REFUSAL: a HEAD_BRANCH that HOLDS THE SHA disarms it, and
// the no-witness refusal does not fire.
//
// WHAT THE CHANGE CLAIMS (templates/pr-review/hooks/merge.sh, the
// accept arm — both halves added by THIS diff):
//
//   # NO WITNESS, NO MERGE (tests-10301): a HEAD_BRANCH that is empty
//   # means the door could not name the reviewed branch — the local
//   # arm cannot verify, so the PR's remote head becomes the ONLY
//   # witness; without a PR number there is nothing to verify against
//   # at all, and the accept refuses rather than merge a branch nobody
//   # can prove still holds the judged bytes.
//
//   if [ -z "${HEAD_BRANCH:-}" ] && [ -z "${PR_NUM:-}" ]; then
//     echo "merge: the reviewed branch cannot be named (no HEAD_BRANCH) and no PR number exists to verify the remote head — unreviewed bytes would ride the merge; re-run the review naming the branch" >&2
//     exit 1
//   fi
//
// and the branch half, whose OWN skip condition is the sha:
//
//   branch_head=""
//   if [ -n "${HEAD_BRANCH:-}" ] && [ "$HEAD_BRANCH" != "$judged_head" ]; then
//     branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" 2>/dev/null || true)"
//     if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//       ... refuse ...
//
// THE WRITER'S LAW (src/doors/review.ts, this diff's own words):
//
//   // the sha is pinned for the bytes; the branch the review is ABOUT
//   // is carried, not derived — ... A sha HERE is a guard that answers
//   // itself forever (tests-10301): when no name exists the honest
//   // value is EMPTY — the merge stage then demands the PR's remote
//   // head as its only remaining witness and refuses without one.
//
// So the WRITER forbids a sha in HEAD_BRANCH (it writes "" instead),
// and the READER's skip condition is EXACTLY that sha case:
// `[ "$HEAD_BRANCH" != "$judged_head" ]` is FALSE for a sha → the
// whole branch comparison is skipped. The no-witness refusal keys on
// HEAD_BRANCH being EMPTY — a sha is not empty — so it does not fire
// either. Result: with a sha in HEAD_BRANCH and no PR number, the
// accept has NO witness at all and merges blind.
//
// THE REACHABLE PATH: HEAD_BRANCH holds the sha in every config the
// PREVIOUS door wrote (the BASE's review.ts wrote `HEAD_BRANCH=${shellQuote(head)}`
// — the raw ref, i.e. the sha whenever the review ran against a sha)
// and in every config a program staged by an older `whl` on PATH
// carries (the exact hazard momentum-907 names). The hook is the
// READER of that file: a reader that accepts a value its writer
// forbids, and whose acceptance means "verified".
//
// THE HARM: MERGE_CMD merges the PR's CURRENT head. Nothing at all
// proves that head is the bytes the verdict judged.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const TEMPLATES = join(ROOT, "templates", "pr-review")

const git = (cwd: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("tests-20002: a HEAD_BRANCH that holds the SHA is not a witness — the accept must REFUSE, not merge blind", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t20002-"))
  try {
    // the repo under review
    const repo = join(tmp, "repo")
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
    const headSha = git(repo, "rev-parse", "feat")

    // a gh stub: the merge command is the real shape, the gh is harmless
    const marker = join(tmp, "merged.txt")
    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho merged > ${marker}\nexit 0\n`)
    chmodSync(join(bin, "gh"), 0o755)

    // the staged program: the hook under test, the config it reads
    const prog = join(tmp, "prog")
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(join(TEMPLATES, "hooks", "merge.sh"), "utf8"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${baseSha}'`,
        // THE FAULT: HEAD_BRANCH holds the SHA — the value this diff's
        // own door refuses to write ("a sha HERE is a guard that
        // answers itself forever"), and the value the PREVIOUS door
        // wrote for every sha-reviewed program
        `HEAD_BRANCH='${headSha}'`,
        `HEAD_SHA='${headSha}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD='gh pr merge 42 --merge'`,
        // no PR number: nothing else can witness the head
        `PR_NUM=''`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", blocked: [], advisory: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
      cwd: prog,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    assert.ok(
      !existsSync(marker),
      `INV-4 (verdicts are honest — the merge must land exactly the bytes the verdict judged): ` +
        `the merge RAN with NO witness: HEAD_BRANCH holds the judged sha, so the branch arm's own ` +
        `skip condition ("$HEAD_BRANCH" != "$judged_head") is FALSE and the comparison never runs; ` +
        `the no-witness refusal keys on HEAD_BRANCH being EMPTY, and a sha is not empty, so it does ` +
        `not fire either; PR_NUM is empty so the remote-head arm is skipped. ` +
        `MERGE_CMD merged the PR's CURRENT head — bytes no verdict judged. ` +
        `(stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
    assert.notEqual(
      r.status,
      0,
      `the accept must REFUSE when nothing proves the head still holds the judged bytes ` +
        `(stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
