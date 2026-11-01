// questions-2 (questions lens, Q2/Q3) — THE HEAD-DRIFT GUARD'S LOCAL ARM IS
// A TAUTOLOGY, AND THE FIELD THAT WAS SUPPOSED TO GIVE IT TEETH HAS NO
// CONSUMER.
//
// What the change claims:
//   src/doors/review.ts:1092-1096 — "the BRANCH NAME, not the pinned sha
//     … the head-drift guard asks 'did the branch move since the review' —
//     with a sha in this field the question answers itself forever, and the
//     guard can never fire"  → the config now carries HEAD_BRANCH=<branch>
//     (the door even derives it: branchOf(headSha)) and a new --head-branch
//     flag carries it down from the auto flow.
//   templates/pr-review/hooks/merge.sh:37 — "The local ref is the proof we
//     always have"; merge.sh:50-57 — "and every ref that pointed at the
//     judged sha, read again".
//
// What the change DOES (templates/pr-review/hooks/merge.sh:45-61):
//   work_head="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"   ← the
//     WORKTREE's head, not the branch's;
//   for ref in $(git -C "$REPO" for-each-ref --points-at "$judged_head" …)
//     now="$(git -C "$REPO" rev-parse "$ref" …)"
//     if [ "$now" != "$judged_head" ]; then drifted=…
// `--points-at <sha>` lists ONLY the refs that point at <sha> RIGHT NOW, so
// `rev-parse` of each of them is <sha> by construction: `drifted` can never
// be non-empty. A ref that MOVED is simply not listed any more. The sweep
// is provably dead code — the "local ref" the comment calls "the proof we
// always have" does not exist.
//
// And HEAD_BRANCH — the field this change rewrote, and the field the
// guard's own comment says the question must be asked through — is read by
// NO production code: `grep -rn HEAD_BRANCH src templates bin` hits the
// writer (src/doors/review.ts:1096) and a COMMENT (merge.sh:42). The field
// vanishes; the branch's own head is never compared with the judged sha.
//
// The scenario: a branch that moved while the reviewed tree stayed put (a
// CI checkout detached at the judged sha, another worktree pushing the
// branch, a stale clone). The worktree head arm sees nothing, the sweep
// sees nothing, and with no PR_NUM (no --pr, a merge command that does not
// name a PR, no gh) the remote arm is off: the accept merges bytes NO
// verdict judged.
//
// The repro drives the REAL hook at its REAL seat with the config the
// door now writes (HEAD_BRANCH = the branch name, HEAD_SHA = the judged
// sha) and asserts the accept REFUSES.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

test("questions-2: the accept must refuse when the BRANCH moved (the local-ref arm has no teeth)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q2-drift-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
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

    // the branch moves while the REVIEWED TREE stays where it was: the
    // branch ref and the remote-tracking ref advance to B, the checked-out
    // tree stays at the judged sha (a CI checkout detached at the sha)
    g("checkout", "-qb", "other")
    writeFileSync(join(repo, "a.txt"), "c\n")
    g("add", "-A")
    g("commit", "-qm", "pushed-during-review")
    const movedHead = g("rev-parse", "HEAD").trim()
    g("branch", "-f", "feat", "other")
    g("update-ref", "refs/remotes/origin/feat", movedHead)
    g("checkout", "--detach", judgedSha)
    assert.equal(g("rev-parse", "HEAD").trim(), judgedSha, "the reviewed tree did not move")
    assert.equal(g("rev-parse", "refs/heads/feat").trim(), movedHead, "the branch DID move")

    // the program the door materializes, with the config the door now
    // writes: HEAD_BRANCH is the BRANCH NAME (this change's own fix for
    // "a sha in this field answers itself forever"), HEAD_SHA the judged
    // sha, and NO PR_NUM (the remote arm is off — this repro is about the
    // LOCAL proof the comment calls "the proof we always have")
    const prog = join(tmp, "prog")
    cpSync(new URL("templates/pr-review", repoRoot), prog, { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    const landed = join(tmp, "landed-tip.txt")
    const mergeCmd = `git -C ${q(repo)} rev-parse refs/heads/feat > ${q(landed)}`
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO=${q(repo)}`,
        `BASE_BRANCH=${q("main")}`,
        `BASE_SHA=${q(baseSha)}`,
        `HEAD_BRANCH=${q("feat")}`,
        `HEAD_SHA=${q(judgedSha)}`,
        `TITLE=${q("PR #42")}`,
        `AUTHOR=${q("")}`,
        `MERGE_CMD=${q(mergeCmd)}`,
      ].join("\n") + "\n",
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }),
    )

    // the merge gate's real seat: the job's run dir (not a git work tree)
    const taskDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
    mkdirSync(taskDir, { recursive: true })

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
      cwd: taskDir,
      encoding: "utf8",
      env: { ...process.env },
    })
    const landedSha = existsSync(landed) ? readFileSync(landed, "utf8").trim() : ""
    assert.notEqual(
      r.status,
      0,
      `the accept must REFUSE when the BRANCH moved (judged ${judgedSha.slice(0, 12)}, branch now ${movedHead.slice(0, 12)}) — the local-ref arm (for-each-ref --points-at) can never fire, and HEAD_BRANCH is read by nobody.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
    assert.equal(
      landedSha,
      "",
      `the merge command ran and took the branch's MOVED tip ${landedSha.slice(0, 12)} — bytes no verdict judged would ride the merge (judged ${judgedSha.slice(0, 12)}).\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
