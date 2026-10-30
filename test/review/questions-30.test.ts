// questions-30 (questions lens, Q2/Q4) — THE MERGE STAGE REPORTS "accepted"
// WHILE THE BASE BRANCH NEVER ADVANCED: BASE_BRANCH FELL BACK TO THE BASE
// SHA.
//
// The change's own claim (src/doors/review.ts, the config it writes):
//   "the BASE rides as the BRANCH NAME too (principles-1 / questions-25):
//    the merge gate checks the base out before merging — a sha there is a
//    detached HEAD and the accept never advances the base branch (it
//    'merged' into nowhere)"
//   BASE_BRANCH=${shellQuote(args.baseBranch ?? branchOf(baseSha) ?? base)}
//
// The derivation `branchOf(baseSha)` answers "which branch points at the
// base sha NOW" — and it answers NOTHING when no branch points at it any
// more: the base branch MOVED while the review ran (the gate resolves the
// base sha BEFORE its jev call, so the window is the whole judgment). Then
// the fallback `?? base` puts the SHA back — and in the gate path `base`
// IS a sha, because the door hands the gate's own resolution down
// (bin/whitehartlane: `base: gateBaseSha ?? val("base")`).
//
// With a sha in BASE_BRANCH, templates/pr-review/hooks/merge.sh:
//   now_base=$(git -C "$REPO" rev-parse "$BASE_BRANCH")   → == BASE_SHA → the
//     base-drift guard can never fire (the very defect the diff repaired
//     on the HEAD side);
//   git -C "$REPO" checkout -q "$BASE_BRANCH"               → a DETACHED HEAD
//     → the --no-ff merge commit lands on a dangling head, the base BRANCH
//     never advances — and the stage still prints
//     "merge: accepted — … merged".
//
// The law the repro asserts (INV-4: the report is honest): when the merge
// stage says the PR was ACCEPTED and merged, the base branch must carry
// the accepted head. BASE behaviour: the door re-resolves the base REF, so
// a moved base refuses the review outright ("head feat is not ahead of
// base main") and nothing claims a merge — the law holds. HEAD: the door
// pins the stale sha, the merge stage merges into a detached HEAD and
// REPORTS a merge that never landed on the branch.
//
// The repro drives the REAL door (the gate ON — the default; the jev stub
// moves the trunk during the gate's own judgment) and the REAL merge.sh.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const isAncestor = (repo: string, a: string, b: string): boolean => {
  try {
    git(repo, "merge-base", "--is-ancestor", a, b)
    return true
  } catch {
    return false
  }
}

test("questions-30: the merge stage must not report an accepted merge that never reached the base branch", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q4-base-moved-"))
  const repo = join(tmp, "repo")
  const home = join(tmp, "home")
  const out = join(tmp, "prog")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    mkdirSync(home, { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")

    // the jev stub: the base branch MOVES during the gate's own judgment
    // (the gate resolves the base sha BEFORE it calls jev, so this is the
    // ordinary race: the trunk moves while the review judges).
    const jev = join(tmp, "jev.sh")
    writeFileSync(
      jev,
      [
        "#!/bin/sh",
        `tree=$(git -C '${repo}' rev-parse 'main^{tree}')`,
        `new=$(git -C '${repo}' commit-tree "$tree" -p main -m "trunk moved")`,
        `git -C '${repo}' update-ref refs/heads/main "$new"`,
        `echo '{"answers":{"l_principles":{"type":"noul","noul":0.9},"l_tests":{"type":"noul","noul":0.9},"l_momentum":{"type":"noul","noul":0.9},"l_questions":{"type":"noul","noul":0.9}}}'`,
        "",
      ].join("\n"),
    )
    chmodSync(jev, 0o755)

    // a no-op orchestrator stub: a scratch drive must never book a real
    // workflow (the box-in-box law)
    const orch = join(tmp, "orch-stub.mjs")
    writeFileSync(orch, `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(join(tmp, "stub-ran.txt"))}, "ok")\n`)

    // the REAL door, the gate ON (the default)
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", out],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          AGENTIC_OS_ORCHESTRATOR: orch,
          AGENTIC_OS_NOTIFY: "0",
          WHL_GATE_LEDGER: join(home, "gate.jsonl"),
          WHL_JEV_BIN: jev,
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    )

    // the door may refuse (BASE's behaviour on a moved base: the review is
    // redone). If it materialized, the REAL merge gate runs (the LOCAL
    // arm — no MERGE_CMD).
    let reported = ""
    if (existsSync(join(out, "data", "review", "config.sh"))) {
      const cfg = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
      const run = join(tmp, "run")
      mkdirSync(run, { recursive: true })
      writeFileSync(
        join(out, "data", "review", "verdict.json"),
        JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }),
      )
      const m = spawnSync("bash", [join(out, "hooks", "merge.sh")], { cwd: run, encoding: "utf8" })
      reported = `${m.stdout}${m.stderr}`
      assert.doesNotMatch(
        cfg,
        /^BASE_BRANCH='[0-9a-f]{7,40}'$/m,
        `BASE_BRANCH must be the base REF — merge.sh compares it with BASE_SHA and checks it out; a sha there makes the base-drift guard a tautology and the merge land on a detached HEAD.\nconfig.sh:\n${cfg}`,
      )
    }
    assert.ok(
      !/merge: accepted/.test(reported) || isAncestor(repo, headSha, "main"),
      `the merge stage reported "merge: accepted … merged" while the base branch main does NOT carry the accepted head: with BASE_BRANCH=<the base sha> the merge checked out a DETACHED HEAD, so the merge commit landed on a dangling head and the base branch never advanced.\ndoor stdout: ${r.stdout}\ndoor stderr: ${r.stderr}\nmerge stdout: ${reported}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
