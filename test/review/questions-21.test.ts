// questions-21 (questions lens, Q2/Q3) — THE HEAD-DRIFT GUARD'S REMOTE ARM
// IS DEAD: NOTHING EVER WRITES PR_NUM.
//
// The change added the guard (templates/pr-review/hooks/merge.sh:15-34):
//   "the MERGE_CMD arm merges the PR's CURRENT head — a push during the
//    review would land bytes no verdict judged. This arm must prove the
//    branch still points at the judged sha before it hands the merge
//    over. The local ref is the proof we always have; the PR's remote
//    head is the stronger one when gh answers."
//
// It asks gh through ${PR_NUM}. NO producer exists: the hook's only input
// channel is data/review/config.sh, and the door that writes it
// (src/doors/review.ts:1040-1050) writes REPO, BASE_BRANCH, BASE_SHA,
// HEAD_BRANCH, HEAD_SHA, TITLE, AUTHOR, MERGE_CMD — no PR_NUM; and the
// door's new --pr flag never reaches the hook or the runner's env
// (bin/whitehartlane:407 reads it for the skip receipt, :542 carries it
// into the minted levy, nowhere else). `grep -rn PR_NUM` over the whole
// repo hits merge.sh and nothing else.
//
// The TWIN that gets it right: the overrule seat (src/doors/ship.ts +
// bin/whitehartlane:746-757) compares `gh pr view <pr> --json headRefOid`
// with the judged sha and REFUSES when gh cannot answer ("unverified is
// unmerged"). The rail's accept merge — the seat that actually merges the
// PR — never asks gh at all.
//
// The repro: a real repo, the template's own merge.sh, a gh stub that
// answers `gh pr view` with the PR's MOVED head and merges the PR's
// current head (what `gh pr merge` does), and the door's own config
// shape. The accept must REFUSE the moved head; today it merges it.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { prepareReview } from "../../src/doors/review.ts"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const q = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

test("questions-21: the accept merge must not land a PR head no verdict judged", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q21-drift-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "a\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    const baseSha = g("rev-parse", "main").trim()
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "b\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const judgedSha = g("rev-parse", "HEAD").trim()
    // a push lands WHILE the review runs: the PR's REMOTE head moves to
    // bytes no verdict judged; the local branch ref stays where it was
    // (a stale clone — the ordinary CI case)
    writeFileSync(join(repo, "src", "wait.ts"), "c\n")
    g("add", "-A")
    g("commit", "-qm", "pushed-during-review")
    const movedHead = g("rev-parse", "HEAD").trim()
    g("reset", "-q", "--hard", judgedSha) // the local branch ref did NOT move
    g("update-ref", "refs/remotes/origin/feat", movedHead)

    // the door's own program + config, materialized by the door itself
    const ready = prepareReview(
      {
        repo,
        base: baseSha,
        head: judgedSha,
        mergeCmd: "gh pr merge 42 --merge",
        out: join(tmp, "out"),
        model: "acme/m",
      },
      join(repoRoot, "templates"),
    )
    assert.ok(ready.ok, `the door must materialize the program: ${ready.ok ? "" : ready.why}`)
    if (!ready.ok) return
    const prog = ready.dir

    // the gh stub: `gh pr view` answers with the PR's CURRENT (moved)
    // head; `gh pr merge` lands that same current head — the documented
    // behaviour of `gh pr merge <n>`
    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    const landed = join(tmp, "landed.txt")
    const ghStub = join(bin, "gh")
    writeFileSync(
      ghStub,
      [
        "#!/bin/sh",
        `case "$1 $2" in`,
        `  "pr view") echo ${movedHead} ;;`,
        `  "pr merge") echo ${movedHead} > ${JSON.stringify(landed)} ;;`,
        `  *) : ;;`,
        `esac`,
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(ghStub, 0o755)

    writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }))

    // 1. the accept must REFUSE the moved PR head
    const runDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
    mkdirSync(runDir, { recursive: true })
    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
      cwd: runDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    })
    assert.ok(
      !existsSync(landed),
      `the accept must not land the PR's moved head (${movedHead.slice(0, 12)}) over the judged bytes (${judgedSha.slice(0, 12)}) — unreviewed bytes rode the merge.\nstderr: ${r.stderr}`,
    )

    // 2. the door must hand the PR number to the hook — the gh arm reads
    //    ${PR_NUM} and the hook's only input channel is config.sh
    const cfg = readFileSync(join(prog, "data", "review", "config.sh"), "utf8")
    assert.match(
      cfg,
      /PR_NUM=/,
      "the door must carry the PR number into the hook's config (PR_NUM) — the gh arm of the head-drift guard reads it and NOTHING produces it, so the remote head is never checked",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
