// tests-10301 (tests lens) — THE HEAD-DRIFT GUARD FAILS OPEN WHEN THE
// HEAD BRANCH CANNOT BE NAMED — the merge stage's own base arm refuses
// an unnameable base ("its drift cannot be verified; refusing"), and
// its own head arm (added by THIS diff) merges blind.
//
// WHAT THE CHANGE CLAIMS (templates/pr-review/hooks/merge.sh, the
// accept arm, the MERGE_CMD path):
//
//   # THE HEAD-DRIFT GUARD (momentum-902, the base twin): the
//   # MERGE_CMD arm merges the PR's CURRENT head — a push during the
//   # review would land bytes no verdict judged. ... this arm must
//   # prove the branch still points at the judged sha before it hands
//   # the merge over.
//
//   judged_head="$HEAD_SHA"
//   branch_head=""
//   if [ -n "${HEAD_BRANCH:-}" ] && [ "$HEAD_BRANCH" != "$judged_head" ]; then
//     branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" ...)"
//     if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//       echo "merge: $HEAD_BRANCH moved ($judged_head -> $branch_head) since
//              the review — unreviewed bytes would ride the merge ..." >&2
//       exit 1
//     fi
//   fi
//
// and the BASE arm of the SAME guard in the SAME file — also added by
// this diff — fails CLOSED on the very condition the head arm treats
// as a pass:
//
//   if [ -z "${BASE_BRANCH:-}" ] || printf '%s' "$BASE_BRANCH" | grep -qE '^[0-9a-f]{7,40}$'; then
//     echo "merge: the base cannot be named (BASE_BRANCH='${BASE_BRANCH:-}') —
//            its drift cannot be verified; refusing ..." >&2
//     exit 1
//   fi
//
// THE DOOR THAT FEEDS THE HEAD ARM (src/doors/review.ts, the config it
// writes) can hand it a SHA instead of a name:
//
//   `HEAD_BRANCH=${shellQuote(
//      args.headBranch && !/^[0-9a-f]{7,40}$/.test(args.headBranch)
//        ? args.headBranch
//        : /^[0-9a-f]{7,40}$/.test(head)
//          ? branchOf(headSha) ?? headSha      // <-- the SHA fallback
//          : head)}`,
//
// with the change's own comment naming the guess as untrustworthy:
//
//   // the branch the review is ABOUT is carried, not derived — a
//   // SIBLING at the judged sha steals an alphabetical guess and the
//   // drift guard reads a ref that never moves.
//
// `branchOf` (review.ts:1063-1071) answers "WHICH branch happens to
// point at this sha, ALPHABETICALLY FIRST?" — and the fallback is the
// sha itself, so the guard's own condition
// `[ "$HEAD_BRANCH" != "$judged_head" ]` is FALSE and the whole check
// is skipped.
//
// TWO REACHABLE WAYS THE HEAD ARM DISARMS ITSELF (both driven here):
//
//   A. the judged sha is at NO local branch tip (a fetched PR head
//      nobody has a local branch for) → branchOf() yields undefined
//      → HEAD_BRANCH = the sha → the guard is skipped entirely.
//
//   B. a SIBLING branch points at the same sha → branchOf() hands the
//      guard the sibling's name — a ref that never moves — while the
//      branch under review moved. The change's own comment calls this
//      the reason the name must be CARRIED; the auto flow carries it
//      only when the operator named a head ref
//      (bin/whitehartlane: `...(headRef !== "HEAD" ? ["--head-branch", q(headRef)] : [])`),
//      so the default flow derives the name instead.
//
// THE HARM: the accept arm hands the merge to MERGE_CMD (the PR's
// CURRENT head) after the reviewed branch moved → bytes no verdict
// judged ride the merge — the exact harm the guard exists to prevent.
//
// The repro drives the change's OWN three pieces — the writer
// (prepareReview → the config.sh it writes), the reader (the real
// templates/pr-review/hooks/merge.sh) and a real git repo whose
// branch moves between the review and the merge — and asserts the
// merge is REFUSED.
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

// a repo whose trunk is main and whose PR branch "zzz-pr" is at the
// reviewed sha.
function fixtureRepo(where: string): { baseSha: string; headSha: string } {
  mkdirSync(where, { recursive: true })
  git(where, "init", "-q", "-b", "main", ".")
  git(where, "config", "user.email", "t@t.local")
  git(where, "config", "user.name", "t")
  writeFileSync(join(where, "base.ts"), "base\n")
  git(where, "add", "-A")
  git(where, "commit", "-qm", "base")
  const baseSha = git(where, "rev-parse", "main")
  git(where, "checkout", "-qb", "zzz-pr")
  writeFileSync(join(where, "pr.ts"), "pr\n")
  git(where, "add", "-A")
  git(where, "commit", "-qm", "pr")
  const headSha = git(where, "rev-parse", "zzz-pr")
  return { baseSha, headSha }
}

// the change's own writer: prepareReview materializes the program and
// writes the config.sh merge.sh reads.
function prepareReviewFor(
  repo: string,
  baseSha: string,
  headSha: string,
  out: string,
  marker: string,
): { ok: boolean; dir?: string; why?: string } {
  const ready = prepareReview(
    {
      repo,
      base: baseSha,
      head: headSha,
      model: "p/m",
      out,
      mergeCmd: `touch ${marker}`,
    },
    TEMPLATES,
  )
  if (!ready.ok) return { ok: false, why: ready.why }
  if (ready.skipped) return { ok: false, why: `skipped: ${ready.why}` }
  // the verdict the merge stage reads
  writeFileSync(
    join(ready.dir, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "accept", blocked: [] }),
  )
  return { ok: true, dir: ready.dir }
}

test("tests-10301: a branch that moved during the review must REFUSE the merge (the head-drift guard)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t10301-"))
  const prevHome = process.env.AGENTIC_OS_HOME
  const prevGh = process.env.GH_CONFIG_DIR
  process.env.AGENTIC_OS_HOME = join(tmp, "home")
  mkdirSync(process.env.AGENTIC_OS_HOME, { recursive: true })
  // a hermetic gh: no auth, no network, no prompts (the door asks gh
  // for the PR number — the answer is irrelevant here)
  process.env.GH_CONFIG_DIR = join(tmp, "gh")
  mkdirSync(process.env.GH_CONFIG_DIR, { recursive: true })
  try {
    // ── case A: the judged sha is at NO local branch tip ─────────────
    {
      const repo = join(tmp, "repoA")
      const { baseSha, headSha } = fixtureRepo(repo)
      // the sha under review is detached from every branch: a fetched
      // PR head nobody has a local branch for
      git(repo, "checkout", "-q", "--detach", headSha)
      git(repo, "branch", "-q", "-D", "zzz-pr")

      const prog = join(tmp, "progA")
      const marker = join(tmp, "mergedA.txt")
      const ready = prepareReviewFor(repo, baseSha, headSha, prog, marker)
      assert.ok(ready.ok, ready.ok ? "" : ready.why)

      const config = readFileSync(join(ready.dir!, "data", "review", "config.sh"), "utf8")
      // the door could not name the head branch → CORRECTED
      // ADOPTED-WITH-THE-FIX: the original assert.match DEMANDED the
      // sha its own message forbade ("must not hand the drift guard a
      // sha") — inverted, the third repro assert of this class. The
      // law: the sha never rides HEAD_BRANCH; unnameable means EMPTY,
      // and the merge stage then demands the PR's remote head as its
      // only witness (refusing without one).
      assert.doesNotMatch(
        config,
        new RegExp(`HEAD_BRANCH='${headSha}'`),
        `the door must not hand the drift guard a sha:\n${config}`,
      )

      // the branch under review moves during the review (a push)
      git(repo, "checkout", "-q", "-b", "zzz-pr", baseSha)
      writeFileSync(join(repo, "pushed.ts"), "pushed\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "pushed")
      assert.notEqual(git(repo, "rev-parse", "zzz-pr"), headSha, "the branch must have moved")

      const r = spawnSync("bash", [join(ready.dir!, "hooks", "merge.sh")], {
        cwd: ready.dir!,
        encoding: "utf8",
        env: { ...process.env, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR },
      })
      assert.notEqual(
        r.status,
        0,
        `the accept must REFUSE a moved branch (stdout: ${r.stdout} stderr: ${r.stderr})`,
      )
      assert.match(r.stderr, /moved|unreviewed bytes/i, `the refusal must say why: ${r.stderr}`)
      assert.ok(
        !existsSync(marker),
        "the merge command RAN — unreviewed bytes ride the merge (the head-drift guard was a no-op)",
      )
    }

    // ── case B: a SIBLING branch points at the judged sha ────────────
    {
      const repo = join(tmp, "repoB")
      const { baseSha, headSha } = fixtureRepo(repo)
      git(repo, "branch", "aaa", headSha) // the sibling that steals the guess

      const prog = join(tmp, "progB")
      const marker = join(tmp, "mergedB.txt")
      const ready = prepareReviewFor(repo, baseSha, headSha, prog, marker)
      assert.ok(ready.ok, ready.ok ? "" : ready.why)

      const config = readFileSync(join(ready.dir!, "data", "review", "config.sh"), "utf8")
      // CORRECTED ADOPTED-WITH-THE-FIX (the fourth inverted pin this
      // loop): the original assert.match DEMANDED the sibling's name —
      // the bug's own shape — while the tail asserts demand the law
      // (the moved branch must refuse). An AMBIGUOUS name (two
      // branches at the judged sha) is no name: the door writes EMPTY,
      // the no-witness refusal and the PR's remote head take over.
      assert.doesNotMatch(
        config,
        /HEAD_BRANCH='aaa'/,
        `the guard must watch the branch under review, not an alphabetical sibling:\n${config}`,
      )

      // the branch under review moves; the sibling stays put
      git(repo, "checkout", "-q", "zzz-pr")
      writeFileSync(join(repo, "pushed.ts"), "pushed\n")
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", "pushed")
      assert.notEqual(git(repo, "rev-parse", "zzz-pr"), headSha, "the branch must have moved")

      const r = spawnSync("bash", [join(ready.dir!, "hooks", "merge.sh")], {
        cwd: ready.dir!,
        encoding: "utf8",
        env: { ...process.env, GH_CONFIG_DIR: process.env.GH_CONFIG_DIR },
      })
      assert.notEqual(
        r.status,
        0,
        `the accept must REFUSE a moved branch (stdout: ${r.stdout} stderr: ${r.stderr})`,
      )
      assert.ok(
        !existsSync(marker),
        "the merge command RAN — the drift guard watched the SIBLING's ref, which never moves",
      )
    }
  } finally {
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    if (prevGh === undefined) delete process.env.GH_CONFIG_DIR
    else process.env.GH_CONFIG_DIR = prevGh
    rmSync(tmp, { recursive: true, force: true })
  }
})
