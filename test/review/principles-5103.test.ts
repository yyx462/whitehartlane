// principles-5103 — the accept lands on a branch NOBODY named: the
// door throws away the reviewer's base branch and substitutes an
// alphabetical guess, so the merge stage merges the judged head into a
// leftover branch while the trunk never advances — and the receipt says
// "merged".
//
// The change introduces the derivation (src/doors/review.ts:1063-1069,
// the NEW `branchOf` helper):
//
//   const branchOf = (sha: string): string | undefined => {
//     const out = execFileSync("git", ["-C", repo, "for-each-ref",
//       "--points-at", sha, "--format=%(refname:short)", "refs/heads"], …)
//     const first = out.split("\n").map(s => s.trim()).filter(Boolean)[0]
//     return first || undefined
//   }
//
// and uses it to NAME the base (src/doors/review.ts:1111):
//
//   `BASE_BRANCH=${shellQuote(args.baseBranch ?? branchOf(baseSha) ?? …)}`
//
// `args.baseBranch` HAS NO PRODUCER: the door passes only
// `headBranch: val("head-branch")` (bin/whitehartlane:621) and there is
// no `--base-branch` flag in the repo. So `branchOf(baseSha)` ALWAYS
// runs — and it answers a DIFFERENT question than the one asked: "which
// branch POINTS AT the base sha NOW", read in `for-each-ref` order
// (alphabetical), not "which branch the reviewer named".
//
// The rename-era repo is the common shape: `main` and `master` sit at
// the SAME base commit (the trunk is one of them; the other is a
// leftover). `for-each-ref` lists them alphabetically, so "main" wins
// over "master" every time — the reviewer's name is discarded.
//
// THE HARM (the merge stage, templates/pr-review/hooks/merge.sh:137-139):
//
//   git -C "$REPO" checkout -q "$BASE_BRANCH"
//   git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept $TITLE" "$HEAD_SHA"
//
// — the accept checks OUT the named branch and merges into it. The
// base-drift guard above it (merge.sh:128-136) CANNOT catch this: the
// wrong branch points at BASE_SHA by construction (branchOf chose it
// FOR that reason), so `now_base == BASE_SHA` and the guard passes.
//
// The change's own claim (src/doors/review.ts:1098-1107) is the
// opposite of what it does:
//
//   "the BASE rides as the BRANCH NAME too (principles-1 /
//    questions-4): the merge gate checks the base out before merging —
//    a sha there is a detached HEAD and the accept never advances the
//    base branch (it 'merged' into nowhere)"
//
// The accept DOES "merge into nowhere": the bytes land on a leftover
// branch, the trunk never advances, and merge.sh:141 still prints
// "merge: accepted — <title> (<sha>) merged" — a receipt for a merge
// that never reached the PR's base.
//
// The repro drives the REAL door (prepareReview) over a rename-era
// fixture, then the REAL merge stage (the materialized merge.sh) with
// an accept verdict, and asserts the only thing that matters: THE
// TRUNK THE REVIEWER NAMED CARRIES THE ACCEPTED HEAD.
//
// BASE behaviour: BASE has no `branchOf`; BASE wrote
// `BASE_BRANCH=${shellQuote(base)}` — the reviewer's own ref verbatim —
// so the accept advances "master" and the assertion PASSES there.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")

test("principles-5103: the accept must advance the base branch the reviewer named", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "p5103-base-"))
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
    // the rename-era shape: main AND master at the SAME base commit —
    // "master" is the trunk, "main" is a leftover that sorts FIRST
    g("branch", "main")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const headSha = g("rev-parse", "feat").trim()

    // THE DOOR — the reviewer names the base branch: "master"
    const out = join(tmp, "prog")
    const { prepareReview } = await import(join(REPO_ROOT, "src", "doors", "review.ts"))
    const r = prepareReview(
      { repo, base: "master", head: "feat", model: "acme/m", out },
      join(REPO_ROOT, "templates"),
    )
    assert.ok(r.ok, `the door must materialize the program (why: ${r.ok ? "" : r.why})`)
    if (!r.ok) return

    const cfg = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
    const named = cfg.match(/^BASE_BRANCH='(.*)'$/m)?.[1]

    // the verdict the prove stage writes, then the REAL merge stage
    writeFileSync(
      join(out, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }),
    )
    mkdirSync(join(out, "run"), { recursive: true })
    const receipt = execFileSync("bash", [join(out, "hooks", "merge.sh")], {
      cwd: join(out, "run"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })

    const carries = (branch: string): boolean => {
      try {
        execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", headSha, branch], { stdio: "ignore" })
        return true
      } catch {
        return false
      }
    }

    assert.ok(
      carries("master"),
      `the accept must advance the base branch the reviewer named ("master") — it did not.\n` +
        `The config named BASE_BRANCH='${named}' (src/doors/review.ts:1111 derives it with branchOf(baseSha) — the FIRST branch "for-each-ref --points-at" lists at the base sha: an alphabetical guess, not the reviewer's name; args.baseBranch has no producer).\n` +
        `The merge stage checks out BASE_BRANCH and merges the judged head into it (templates/pr-review/hooks/merge.sh:137-139), and its base-drift guard (merge.sh:128-136) cannot catch it — the wrong branch points at BASE_SHA by construction. So the accept landed on '${named}' while the trunk never advanced, and the receipt still said:\n${receipt}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
