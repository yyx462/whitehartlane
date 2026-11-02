// questions-31 (questions lens, Q2/Q3) — THE DOOR NAMES THE WRONG BASE
// BRANCH: the derived BASE_BRANCH is an ALPHABETICAL GUESS, not the
// branch the reviewer named.
//
// What the change does (src/doors/review.ts:1063-1066, the NEW
// `branchOf` helper):
//
//   const branchOf = (sha: string): string | undefined => {
//     const out = execFileSync("git", ["-C", repo, "for-each-ref",
//       "--points-at", sha, "--format=%(refname:short)", "refs/heads"], ...)
//     const first = out.split("\n").map(s => s.trim()).filter(Boolean)[0]
//     return first || undefined
//   }
//
// and the config it writes (src/doors/review.ts:1111):
//
//   `BASE_BRANCH=${shellQuote(args.baseBranch ?? branchOf(baseSha) ?? (
//      /^[0-9a-f]{7,40}$/.test(base) ? "" : base))}`
//
// `args.baseBranch` HAS NO PRODUCER: the bin passes only
// `headBranch: val("--head-branch")` (bin/whitehartlane:621) and there
// is no `--base-branch` flag anywhere in the repo (grep: zero hits).
// So the second term ALWAYS runs, and `branchOf` answers a DIFFERENT
// question than the one the base-drift guard asks: "WHICH branch
// happens to point at this sha, alphabetically first?" — not "the
// branch the review was based on".
//
// `git for-each-ref` sorts by refname, so a repo that carries BOTH
// `main` and `master` at the same base sha names `main` even when the
// reviewer asked for `--base master`. The rename-era repo is the
// common shape (main + master coexisting at one commit).
//
// THE HARM (the merge stage, templates/pr-review/hooks/merge.sh:137):
//
//   git -C "$REPO" checkout -q "$BASE_BRANCH" || { ...refuse... }
//   git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept $TITLE" "$HEAD_SHA"
//
// The accept checks OUT the named branch and merges the judged head
// INTO it. With the wrong name the merge lands on a branch the PR was
// NEVER based on, and the PR's real base branch never advances —
// while merge.sh prints "merge: accepted — <title> (<sha>) merged".
// The repo's own drill asserts exactly this property (the accept must
// advance the base branch: test/e2e/pr-review/run-drill.sh's
// check_merge reads `git -C "$root/c1" log main`).
//
// The change's own claim (src/doors/review.ts:1098-1107) is the
// opposite of what it does:
//
//   // the BASE rides as the BRANCH NAME too (principles-1 /
//   // questions-4): the merge gate checks the base out before
//   // merging — a sha there is a detached HEAD and the accept never
//   // advances the base branch (it "merged" into nowhere).
//   // The FALLBACK must never emit a sha (questions-30): when no
//   // branch points at the base sha any more (the base moved during
//   // the review), an empty name is the honest value
//
// The claim is about the BASE'S OWN NAME — the review's base. The
// implementation answers "some branch at this sha".
//
// The repro drives the REAL door (prepareReview) over a rename-era
// fixture (main AND master at the base sha), asks for `--base master`,
// and asserts the config names the branch the reviewer named.
//
// BASE behaviour: src/doors/review.ts has no `branchOf`; BASE wrote
// `BASE_BRANCH=${shellQuote(base)}` — the reviewer's own ref verbatim.
// So BASE names `master` and the assertion PASSES there.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")

test("the config names the BASE branch the reviewer named, not an alphabetical guess", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q31-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" })
    g("init", "-q", "-b", "master", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    // the rename-era shape: main AND master at the SAME base sha
    g("branch", "main")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")

    const out = join(tmp, "prog")
    const { prepareReview } = await import(join(HEAD, "src", "doors", "review.ts"))
    const r = prepareReview({ repo, base: "master", head: "feat", model: "acme/m", out }, join(HEAD, "templates"))
    assert.ok(r.ok, `the door must materialize the program (why: ${r.ok ? "" : r.why})`)
    if (!r.ok) return

    const cfg = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
    const named = cfg.match(/^BASE_BRANCH='(.*)'$/m)?.[1]
    assert.equal(
      named,
      "master",
      `the config must name the base branch the reviewer asked for ("master"), not whichever branch sorts first at the base sha — got '${named}'.\n` +
        `The merge stage checks OUT BASE_BRANCH and merges the judged head INTO it (templates/pr-review/hooks/merge.sh:137-139), so a wrong name lands the accept on a branch the PR was never based on while printing "merge: accepted".\n` +
        `config.sh:\n${cfg}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
