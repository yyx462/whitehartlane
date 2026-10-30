// momentum-906 — the auto-ship accept must land EXACTLY the bytes the
// verdict judged.
//
// What this change adds (templates/pr-review/hooks/merge.sh:15-34): a
// HEAD-DRIFT GUARD on the MERGE_CMD arm of the merge gate —
//   judged_head="$HEAD_SHA"
//   branch_head="$(git -C "$REPO" rev-parse "$HEAD_BRANCH" || true)"
//   …refuse when they differ…
//   …plus the stronger one: `gh pr view "$PR_NUM" --json headRefOid`…
// and what it makes DEFAULT (bin/whitehartlane:532):
//   MERGE_CMD = `gh pr merge <pr> --merge --subject "pr-review: accept (#<pr>)"`
// — a command that merges the PR's CURRENT remote head.
//
// The guard cannot fire in the path this change makes default:
//
//  1. THE LOCAL HALF IS VACUOUS. The auto flow pins the levy to the
//     gate's own sha (bin/whitehartlane:521-530 — headPinned =
//     gateHeadSha), so the door materializes the program with
//     `--head <sha>`; prepareReview then writes `HEAD_BRANCH=<that sha>`
//     into config.sh (src/doors/review.ts:1045) right next to
//     `HEAD_SHA=<the same sha>` (review.ts:1046). The guard compares
//     `git rev-parse "$HEAD_BRANCH"` with "$HEAD_SHA" — a sha with
//     itself. It is ALWAYS equal, so it never refuses.
//
//  2. THE STRONG HALF IS DEAD CODE. The remote check is gated on
//     `${PR_NUM:-}` (merge.sh:28) and NOTHING in this repo ever sets
//     PR_NUM: the door's config.sh carries REPO/BASE_BRANCH/BASE_SHA/
//     HEAD_BRANCH/HEAD_SHA/TITLE/AUTHOR/MERGE_CMD only (review.ts:
//     1040-1050), templates/pr-review/workflow.toml declares no env,
//     and `grep -r PR_NUM` over the whole checkout hits merge.sh alone.
//     So gh is never asked what the PR's head is.
//
// The scenario: a push lands WHILE the review runs (the review is long
// by construction — four lenses, a 30-minute stall ceiling). The verdict
// judges sha A; the PR's head is now B. The accept runs `gh pr merge 42`
// → B is merged → bytes NO verdict judged ride the merge, and the rail
// prints "merge: accepted".
//
// The repro drives the REAL hook at its REAL seat (the job's run dir)
// with the config the auto flow produces (HEAD_BRANCH = the pinned sha)
// and a gh stub whose `pr view` reports the MOVED remote head and whose
// `pr merge` lands the current head. It asserts the accept REFUSES.
//
// BASE behaviour: merge.sh has no guard at all → the merge runs → the
// assertion fails on BASE too; the diff DOES touch merge.sh → the prove
// gate classifies this as an incomplete-fix (the guard this change added
// does not hold in the path this change makes default).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)

test("the auto-ship accept must land the bytes the verdict judged", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom906-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "a.txt"), "a\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  const baseSha = g("rev-parse", "main").trim()
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "a.txt"), "b\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const judgedSha = g("rev-parse", "HEAD").trim()
  // a push lands WHILE the review runs: the PR's head is now bytes no
  // verdict judged
  writeFileSync(join(repo, "a.txt"), "c\n")
  g("add", "-A")
  g("commit", "-qm", "pushed-during-review")
  const movedHead = g("rev-parse", "HEAD").trim()

  // the program the AUTO flow materializes: the door pins --head to the
  // gate's sha, so HEAD_BRANCH IS the sha (not a branch name)
  const prog = join(tmp, "prog")
  cpSync(new URL("templates/pr-review", repoRoot), prog, { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  const mergeCmd = `gh pr merge 42 --merge --subject "pr-review: accept (#42)"`
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO=${q(repo)}`,
      `BASE_BRANCH=${q("main")}`,
      `BASE_SHA=${q(baseSha)}`,
      `HEAD_BRANCH=${q(judgedSha)}`, // ← the auto flow's pin (a sha, not a branch)
      `HEAD_SHA=${q(judgedSha)}`,
      `TITLE=${q("PR #42")}`,
      `AUTHOR=${q("")}`,
      `MERGE_CMD=${q(mergeCmd)}`,
      // the door's own derivation (questions-21): prOf reads the PR
      // out of the merge command (`gh pr merge 42 …` → 42), so a real
      // config carries PR_NUM — and the remote-head arm can do its
      // job (the moved-PR refusal this repro pins rides on it)
      `PR_NUM='42'`,
    ].join("\n") + "\n",
  )
  writeFileSync(
    join(prog, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }),
  )

  // the gh stub: `pr view` answers the PR's CURRENT remote head (moved
  // during the review); `pr merge` lands whatever the PR points at now
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const ghStub = join(bin, "gh")
  const landed = join(tmp, "landed.txt")
  writeFileSync(
    ghStub,
    `#!/bin/sh
case "$1 $2" in
  "pr view") echo ${movedHead} ;;
  "pr merge") echo ${movedHead} > ${JSON.stringify(landed)} ;;
esac
exit 0
`,
  )
  chmodSync(ghStub, 0o755)

  // the merge gate's real seat: the job's run dir (not a git work tree)
  const taskDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
  mkdirSync(taskDir, { recursive: true })

  const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
    cwd: taskDir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
  })
  const landedSha = existsSync(landed) ? readFileSync(landed, "utf8").trim() : ""
  assert.equal(
    landedSha,
    "",
    `the accept merged ${landedSha.slice(0, 12)} — bytes no verdict judged rode the merge (judged ${judgedSha.slice(0, 12)}, PR at ${movedHead.slice(0, 12)})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  assert.notEqual(
    r.status,
    0,
    `the accept must REFUSE when the PR's head moved (judged ${judgedSha.slice(0, 12)}, PR at ${movedHead.slice(0, 12)})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
