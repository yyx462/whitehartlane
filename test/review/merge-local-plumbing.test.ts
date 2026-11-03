// merge-local-plumbing — #273's law, pinned: the local merge arm
// NEVER checks out the base branch. The old arm ran `git checkout
// $BASE_BRANCH` inside the reviewed repo — which refuses whenever
// another worktree holds the branch, and in a worktree-project world
// that is the layout, not the exception: the trunk worktree always
// holds the base. r267's final round was a 0-blocked ACCEPT that
// landed as 'refused' with "fatal: 'master' is already used by
// worktree at …/master" (j-5b8a3b).
//
// The repro builds EXACTLY that layout: a base branch held by a
// second worktree, a judged head, an accept verdict — and drives the
// REAL hooks/merge.sh. BASE behaviour: the checkout refuses and the
// stage exits nonzero. NEW behaviour: merge-tree/commit-tree/update-
// ref land the two-parent merge without disturbing any checkout, and
// the drift window stays armed (a base that moved refuses).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)

function fixture(tmp: string) {
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "a.txt"), "a\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  const baseSha = g("rev-parse", "main").trim()
  // the head: one honest commit on top — and the reviewed repo STAYS
  // on it (a real PR worktree's posture; the old arm's `checkout main`
  // is what collided with the trunk holding it)
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "a.txt"), "b\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const headSha = g("rev-parse", "HEAD").trim()
  // THE #273 LAYOUT: another worktree holds the base branch — the
  // trunk worktree's birthright
  execFileSync("git", ["-C", repo, "worktree", "add", join(tmp, "trunk"), "main"])
  return { repo, baseSha, headSha, g }
}

function stageProg(tmp: string, repo: string, baseSha: string, headSha: string) {
  const prog = join(tmp, "prog")
  cpSync(new URL("templates/pr-review", repoRoot), prog, { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO=${q(repo)}`,
      `BASE_BRANCH=${q("main")}`,
      `BASE_SHA=${q(baseSha)}`,
      `HEAD_BRANCH=${q("feat")}`,
      `HEAD_SHA=${q(headSha)}`,
      `TITLE=${q("the PR")}`,
      `AUTHOR=${q("")}`,
    ].join("\n") + "\n",
  )
  writeFileSync(
    join(prog, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }),
  )
  const taskDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
  mkdirSync(taskDir, { recursive: true })
  // the labs as intake leaves them (under the STAGED program dir) —
  // with a corpus the trap must ride out on the way to accept
  mkdirSync(join(prog, "data", "review", "head", "test", "review"), { recursive: true })
  writeFileSync(join(prog, "data", "review", "head", "test", "review", "momentum-1.test.ts"), "// repro\n")
  return { prog, taskDir }
}

test("an accept merges while ANOTHER worktree holds the base branch (#273)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-m273-"))
  try {
    const { repo, baseSha, headSha, g } = fixture(tmp)
    const { prog, taskDir } = stageProg(tmp, repo, baseSha, headSha)
    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: taskDir, encoding: "utf8" })
    assert.equal(r.status, 0, `merge.sh failed: ${r.stderr}`)
    // the outcome seat says accept — not 'refused' (the seat lives in
    // the STAGED program dir, where the watcher waits)
    assert.match(readFileSync(join(prog, "data", "review", "merge.json"), "utf8"), /"outcome":"accept"/)
    // the base branch carries the two-parent merge of the judged head
    const tip = g("rev-parse", "main").trim()
    assert.notEqual(tip, baseSha)
    assert.equal(g("rev-parse", "main^1").trim(), baseSha)
    assert.equal(g("rev-parse", "main^2").trim(), headSha)
    assert.match(g("log", "-1", "--format=%s", "main"), /pr-review: accept/)
    // the trunk worktree STILL holds main (never disturbed) — and the
    // undisturbed invariant is the CHECKOUT, not the resolved ref
    // (update-ref moved main; a worktree holding it resolves the ref's
    // new tip but its checked-out files never changed: the old arm
    // switched checkouts, plumbing never does)
    const holders = execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" })
    // (macos resolves /var → /private/var in porcelain; assert the
    // FACT, not the spelling: the only branch-holder of main is trunk)
    assert.match(holders, /HEAD [0-9a-f]+\nbranch refs\/heads\/main/)
    assert.doesNotMatch(holders, /detached/)
    assert.equal(readFileSync(join(repo, "a.txt"), "utf8"), "b\n", "the reviewed repo (on feat) must not move")
    assert.equal(readFileSync(join(tmp, "trunk", "a.txt"), "utf8"), "a\n", "the trunk worktree's checkout must not move")
    assert.equal(g("status", "--porcelain").trim(), "", "no checkout was dirtied by the merge")
    // the labs dematerialized on the way out (the trap still owns them
    // on the merge path) — the corpus rode out to the fixer's seat
    assert.ok(!existsSync(join(prog, "data", "review", "head")))
    assert.ok(existsSync(join(prog, "data", "review", "repros", "test", "review", "momentum-1.test.ts")))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a base that moved under the merge refuses (the CAS window stays armed)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-m273b-"))
  try {
    const { repo, baseSha, headSha, g } = fixture(tmp)
    // the base moves AFTER intake pinned BASE_SHA — committed from the
    // trunk worktree (the realistic mover), the drift the early check
    // and the compare-and-swap old value exist to catch
    writeFileSync(join(tmp, "trunk", "a.txt"), "z\n")
    execFileSync("git", ["-C", join(tmp, "trunk"), "add", "-A"])
    execFileSync("git", ["-C", join(tmp, "trunk"), "commit", "-qm", "base moved"])
    const { prog, taskDir } = stageProg(tmp, repo, baseSha, headSha)
    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: taskDir, encoding: "utf8" })
    assert.notEqual(r.status, 0, "a moved base must refuse")
    assert.match(r.stderr, /moved under the merge|re-run the review/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
