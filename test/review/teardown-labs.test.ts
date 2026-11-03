// teardown-labs — #278's law, pinned: the run's END owns its labs.
// Every ending dematerializes them — repros ride out to data/review/
// repros/ FIRST (#260's ordering, the fixer's adoption contract), the
// checkout dirs go second, `worktree prune` last (prune-before-rm
// leaves stale metadata and the next `worktree add` dies with 128).
//
// The receipt: 64 registrations accumulated in .bear (2026-11-03)
// because teardown lived only in merge.sh's EXIT trap — rounds that
// died before the merge stage retired panes and leaked labs, 2 per
// round, forever.
//
// This pins the writer≡reader round-trip: the corpus the head lab
// carries is EXACTLY the corpus repros/ ends up holding (a fixer that
// reads repros/ sees every byte a lens wrote), the labs are GONE, the
// repo's worktree metadata no longer names them, and a second pass is
// a no-op (idempotent — the finish seat and the merge trap can both
// fire).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { teardownReviewLabs } from "../../src/adapters/teardown.ts"

test("the end owns the labs: ride out, remove, prune — and idempotent", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-teardown-"))
  try {
    // a real repo with a real commit, and two REAL worktree labs
    // minted the way intake mints them (worktree add --detach)
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
    const baseSha = g("rev-parse", "HEAD").trim()
    writeFileSync(join(repo, "a.txt"), "b\n")
    g("add", "-A")
    g("commit", "-qm", "head")
    const headSha = g("rev-parse", "HEAD").trim()

    const taskDir = join(tmp, "run")
    const review = join(taskDir, "data", "review")
    mkdirSync(review, { recursive: true })
    const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
    writeFileSync(
      join(review, "config.sh"),
      [`REPO=${q(repo)}`, `BASE_BRANCH=${q("main")}`, `BASE_SHA=${q(baseSha)}`, `HEAD_SHA=${q(headSha)}`].join("\n") + "\n",
    )
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", join(review, "head"), headSha])
    execFileSync("git", ["-C", repo, "worktree", "add", "--detach", join(review, "base"), baseSha])
    // the lens corpus inside the head lab — two repros, one stray
    const corpus = join(review, "head", "test", "review")
    mkdirSync(corpus, { recursive: true })
    writeFileSync(join(corpus, "momentum-1.test.ts"), "// repro one\n")
    writeFileSync(join(corpus, "tests-2.test.ts"), "// repro two\n")

    const listed = () =>
      execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" })
    assert.match(listed(), /data\/review\/head/)
    assert.match(listed(), /data\/review\/base/)

    const receipt = teardownReviewLabs(taskDir)!
    // the writer≡reader round-trip: every corpus byte survives
    assert.equal(receipt.rodeOut, 2)
    assert.ok(existsSync(join(review, "repros", "test", "review", "momentum-1.test.ts")))
    assert.ok(existsSync(join(review, "repros", "test", "review", "tests-2.test.ts")))
    // the labs are gone, and the repo's metadata no longer names them
    assert.deepEqual(receipt.removed.sort(), ["base", "head"])
    assert.ok(!existsSync(join(review, "head")))
    assert.ok(!existsSync(join(review, "base")))
    assert.equal(receipt.pruned, true)
    assert.doesNotMatch(listed(), /data\/review\/head/)
    assert.doesNotMatch(listed(), /data\/review\/base/)

    // idempotent: the finish seat and the merge trap can both fire
    assert.equal(teardownReviewLabs(taskDir), null)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a non-review run dir is a no-op, never an error", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-teardown-none-"))
  try {
    assert.equal(teardownReviewLabs(tmp), null)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a repo-less run still removes its labs (prune is best-effort)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-teardown-norepo-"))
  try {
    const review = join(tmp, "data", "review")
    mkdirSync(join(review, "head", "test", "review"), { recursive: true })
    writeFileSync(join(review, "head", "test", "review", "x.test.ts"), "// x\n")
    // no config.sh — the repo cannot be named; prune is skipped, the
    // labs still go (a stale metadata row is a log line, not a leak)
    const receipt = teardownReviewLabs(tmp)!
    assert.equal(receipt.rodeOut, 1)
    assert.deepEqual(receipt.removed, ["head"])
    assert.equal(receipt.pruned, false)
    assert.ok(!existsSync(join(review, "head")))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
