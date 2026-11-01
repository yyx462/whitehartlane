// tests-10101 (tests lens) — THE DOOR NAMES THE WRONG BRANCH FOR THE
// HEAD-DRIFT GUARD: HEAD_BRANCH is "whichever local branch happens to
// point at the judged sha, ALPHABETICALLY FIRST", not the branch the
// review is about.
//
// What this change adds (src/doors/review.ts:1063-1069, the NEW
// `branchOf` helper):
//
//   const branchOf = (sha: string): string | undefined => {
//     const out = execFileSync("git", ["-C", repo, "for-each-ref",
//       "--points-at", sha, "--format=%(refname:short)", "refs/heads"], …)
//     const first = out.split("\n").map((s) => s.trim()).filter(Boolean)[0]
//     return first || undefined
//   }
//
// and uses it to NAME THE HEAD (src/doors/review.ts:1118):
//
//   `HEAD_BRANCH=${shellQuote(args.headBranch ?? branchOf(headSha) ?? head)}`
//
// The change's own law for this field (src/doors/review.ts:1113-1117):
//
//   // the BRANCH NAME, not the pinned sha (momentum-906 /
//   // principles-4001 / questions-21): the head-drift guard asks
//   // "did the branch move since the review" — with a sha in this
//   // field the question answers itself forever, and the guard can
//   // never fire
//
// THE DEFECT: the field answers a DIFFERENT question than the one the
// guard asks. "WHICH branch points at this sha, first in refname order"
// is not "the branch this review is about" — and the door already HAS
// the right answer in hand: the caller NAMED it (`--head feat` →
// args.head; the door's own `headBranch` = the checkout's branch,
// src/doors/review.ts:730-736). The derivation throws the named branch
// away and substitutes an alphabetical guess.
//
// `git for-each-ref` sorts by refname, so a repo that carries a sibling
// branch at the same commit (a backup branch, a stacked branch, a
// release branch cut from the head) hands the guard the WRONG ref. The
// sibling sorts FIRST whenever its name sorts before the reviewed
// branch's — `backup` before `feat`, `aaa-*` before anything.
//
// THE HARM (templates/pr-review/hooks/merge.sh:49-66, the guard this
// same change adds):
//
//   judged_head="$HEAD_SHA"
//   branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}")"
//   if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//     … refuse …
//
// The guard asks ONE ref — the one the door named. If the door named
// the wrong ref, the guard watches a ref that never moves and NEVER
// fires: the reviewed branch moved (bytes no verdict judged), and the
// accept sails through. (The harm is pinned end-to-end by
// test/review/tests-10102.test.ts; this file pins the naming law.)
//
// BASE behaviour: BASE wrote `HEAD_BRANCH=${shellQuote(head)}` — the
// branch the reviewer NAMED — so the naming law held there. HEAD names
// an alphabetical guess → the diff INTRODUCED the wrong name.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")

const g = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

// the config the door writes — the single hand-down every hook reads
const configOf = (dir: string): Record<string, string> => {
  const raw = readFileSync(join(dir, "data", "review", "config.sh"), "utf8")
  const out: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^'(.*)'$/, "$1")
  }
  return out
}

test("tests-10101: HEAD_BRANCH names the branch the review is about, not an alphabetical sibling", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t10101-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  g(repo, "init", "-q", "-b", "main", ".")
  g(repo, "config", "user.email", "t@t.local")
  g(repo, "config", "user.name", "t")
  writeFileSync(join(repo, "src.ts"), "export const a = 1\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "base")
  g(repo, "checkout", "-qb", "feat")
  writeFileSync(join(repo, "src.ts"), "export const a = 2\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "feat")
  // a SIBLING branch at the SAME commit — the ordinary git shape
  // ("git branch backup" before a push). It sorts FIRST in refname
  // order, so the door's `for-each-ref … [0]` picks IT.
  g(repo, "branch", "backup")
  const judged = g(repo, "rev-parse", "feat")
  assert.equal(g(repo, "for-each-ref", "--points-at", judged, "--format=%(refname:short)", "refs/heads").split("\n")[0], "backup", "the fixture must have a sibling that sorts first")

  try {
    const out = join(tmp, "prog")
    const ready = prepareReview({ repo, base: "main", head: "feat", model: "p/m", out }, TEMPLATES)
    assert.ok(ready.ok && !ready.skipped, ready.ok ? "" : (ready as { why: string }).why)
    const cfg = configOf(ready.ok ? ready.dir : "")
    // the law: the guard must watch THE branch the review judged
    assert.equal(
      cfg.HEAD_BRANCH,
      "feat",
      `HEAD_BRANCH must name the reviewed branch ('feat'); it named '${cfg.HEAD_BRANCH}' — the door's alphabetical guess (git for-each-ref --points-at lists 'backup' first) points the head-drift guard at a ref that never moves`,
    )
    // and it must be a NAME, not a sha (the diff's own claim)
    assert.doesNotMatch(cfg.HEAD_BRANCH ?? "", /^[0-9a-f]{7,40}$/, "a sha in HEAD_BRANCH answers the guard's question forever")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("tests-10101b: the named branch wins even when a sibling sorts first (the --head-branch pin is honoured)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t10101b-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  g(repo, "init", "-q", "-b", "main", ".")
  g(repo, "config", "user.email", "t@t.local")
  g(repo, "config", "user.name", "t")
  writeFileSync(join(repo, "src.ts"), "export const a = 1\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "base")
  g(repo, "checkout", "-qb", "feat")
  writeFileSync(join(repo, "src.ts"), "export const a = 2\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "feat")
  g(repo, "branch", "backup")
  try {
    const out = join(tmp, "prog")
    const ready = prepareReview(
      { repo, base: "main", head: "feat", headBranch: "feat", model: "p/m", out },
      TEMPLATES,
    )
    assert.ok(ready.ok && !ready.skipped, ready.ok ? "" : (ready as { why: string }).why)
    const cfg = configOf(ready.ok ? ready.dir : "")
    // the CONTROL arm: with the branch named explicitly, the door
    // honours it — the defect is the DERIVATION, not the field
    assert.equal(cfg.HEAD_BRANCH, "feat", "the explicit branch name must ride the config")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
