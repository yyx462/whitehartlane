// tests-10102 (tests lens) — THE HEAD-DRIFT GUARD NEVER FIRES: the door
// names the wrong ref for it, so unreviewed bytes ride the merge.
//
// This change adds a HEAD-DRIFT GUARD to the merge gate
// (templates/pr-review/hooks/merge.sh:42-96) and says what it is for
// (merge.sh:42-48):
//
//   # THE HEAD-DRIFT GUARD (momentum-902, the base twin): the
//   # MERGE_CMD arm merges the PR's CURRENT head — a push during the
//   # review would land bytes no verdict judged. … this arm must prove
//   # the branch still points at the judged sha before it hands the
//   # merge over.
//
// and it asks ONE ref (merge.sh:56-66):
//
//   if [ -n "${HEAD_BRANCH:-}" ] && [ "$HEAD_BRANCH" != "$judged_head" ]; then
//     branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" …)"
//     if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//       … refuse …
//
// THE DEFECT (src/doors/review.ts:1118): the ref it asks is not the
// reviewed branch.
//
//   `HEAD_BRANCH=${shellQuote(args.headBranch ?? branchOf(headSha) ?? head)}`
//
// `branchOf` (review.ts:1063) answers "which local branch points at the
// judged sha, ALPHABETICALLY FIRST" (`git for-each-ref --points-at …`
// sorts by refname). A sibling branch at the same commit (a backup
// branch, a stacked branch, a release branch cut from the head) sorts
// first and STEALS the field. The guard then watches a ref that never
// moves — so it never fires.
//
// THE OTHER TWO WITNESSES DO NOT COVER THIS PATH:
//   * the ref sweep (merge.sh:74-85) lists refs that STILL point at the
//     judged sha — a moved branch is not in the list, so the sweep is
//     vacuous for a move (questions-23 already documents that);
//   * the gh arm (merge.sh:86-96) needs PR_NUM, and PR_NUM is empty
//     whenever the merge command does not name a PR (a local merge —
//     `make merge`, `git merge …` — names no PR, and the door's
//     prOf() finds no PR to derive: review.ts:1077-1090).
//
// THE SCENARIO (the ordinary one): the reviewer reviews the branch
// `feat`; a sibling `backup` branch sits at the same commit (the shape
// every "git branch backup before I push" makes); during the review a
// push lands on `feat` (bytes no verdict judged); the merge stage runs.
//
// BASE behaviour: BASE has no head-drift guard at all → the merge runs
// → the assertion fails on BASE too; the diff DOES touch merge.sh and
// ADDS the guard → the prove gate classifies this as an
// incomplete-fix (the guard this change adds does not hold in the path
// this change makes default).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")

const g = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const configOf = (dir: string): Record<string, string> => {
  const raw = readFileSync(join(dir, "data", "review", "config.sh"), "utf8")
  const out: Record<string, string> = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^'(.*)'$/, "$1")
  }
  return out
}

test("tests-10102: the accept must refuse when the REVIEWED branch moved, even with a sibling at the judged sha", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t10102-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  g(repo, "init", "-q", "-b", "main", ".")
  g(repo, "config", "user.email", "t@t.local")
  g(repo, "config", "user.name", "t")
  writeFileSync(join(repo, "src.ts"), "export const a = 1\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "base")
  const baseSha = g(repo, "rev-parse", "main")
  g(repo, "checkout", "-qb", "feat")
  writeFileSync(join(repo, "src.ts"), "export const a = 2\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "feat")
  const judged = g(repo, "rev-parse", "feat")
  // the sibling: the ordinary "backup before I push" branch, at the
  // SAME commit, and it sorts FIRST in refname order
  g(repo, "branch", "backup")

  // the merge command names NO PR (a local merge — the shape that
  // leaves PR_NUM empty, so the gh arm is dead and the branch half is
  // the only witness)
  const mergeCmd = `git -C ${JSON.stringify(repo)} checkout -q main && git -C ${JSON.stringify(repo)} merge --no-ff --no-edit -m "pr-review: accept" feat`

  const out = join(tmp, "prog")
  const ready = prepareReview({ repo, base: "main", head: "feat", model: "p/m", out, mergeCmd }, TEMPLATES)
  assert.ok(ready.ok && !ready.skipped, ready.ok ? "" : (ready as { why: string }).why)
  const dir = ready.ok ? ready.dir : ""
  const cfg = configOf(dir)
  assert.equal(cfg.HEAD_SHA, judged, "the config must judge the head the review ran on")
  assert.equal(cfg.PR_NUM, "", "this scenario is the one with no PR number: the gh arm cannot watch")

  // THE PUSH LANDS DURING THE REVIEW: the reviewed branch moves to
  // bytes no verdict judged. The sibling `backup` stays where it is.
  writeFileSync(join(repo, "src.ts"), "export const a = 3\n")
  g(repo, "add", "-A")
  g(repo, "commit", "-qm", "pushed-during-review")
  const moved = g(repo, "rev-parse", "feat")
  assert.notEqual(moved, judged)

  // the verdict the rail wrote: accept
  writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: judged, blocked: [] }))
  const run = join(tmp, "run")
  mkdirSync(run, { recursive: true })
  const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], { cwd: run, encoding: "utf8" })

  const mainNow = g(repo, "rev-parse", "main")
  assert.notEqual(
    mainNow,
    moved,
    `the accept merged ${mainNow.slice(0, 12)} — the branch moved to ${moved.slice(0, 12)} while the review judged ${judged.slice(0, 12)}; unreviewed bytes rode the merge\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  // CORRECTED ADOPTED-WITH-THE-FIX: the repro's original assert demanded
  // main == judged, but its own header's spec ("the guard must fire, the
  // merge must refuse") never puts judged into main — a REFUSED merge
  // merges nothing, and main stays at the base it started from. The
  // header's law is pinned; the contradictory assert was the repro's
  // bug, not the gate's.
  assert.equal(
    mainNow,
    baseSha,
    `the refusal must merge NOTHING — main stays at the base (${baseSha.slice(0, 12)}); it carries ${mainNow.slice(0, 12)}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  assert.notEqual(
    r.status,
    0,
    `the head-drift guard must REFUSE when the reviewed branch moved (judged ${judged.slice(0, 12)}, branch now ${moved.slice(0, 12)}); HEAD_BRANCH='${cfg.HEAD_BRANCH}' named the wrong ref, so the guard never fired\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  assert.doesNotMatch(
    `${r.stdout}${r.stderr}`,
    /accepted/,
    `the stage must not report an accepted merge of bytes no verdict judged\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
