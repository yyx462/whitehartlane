// questions-25 (questions lens, Q2/Q3) — THE BASE TWIN OF THE BRANCH FIX
// WAS LEFT WRONG: BASE_BRANCH is now the base SHA.
//
// What this change fixed on the HEAD side (src/doors/review.ts:1091-1096):
//   "the BRANCH NAME, not the pinned sha (momentum-906 / principles-4001):
//    the head-drift guard asks 'did the branch move since the review' — with
//    a sha in this field the question answers itself forever, and the guard
//    can never fire"
//   → HEAD_BRANCH = the branch name.
//
// What the same change did to the BASE side (src/doors/review.ts:1089 and
// bin/whitehartlane:600): the door is now handed the GATE's own resolution —
//   base: gateBaseSha ?? val("base")
// — a SHA, and it writes it straight into the config:
//   BASE_BRANCH='<the base sha>'
// templates/pr-review/hooks/merge.sh reads BASE_BRANCH twice:
//   :84  now_base=$(git -C "$REPO" rev-parse "$BASE_BRANCH")
//        if [ "$now_base" != "$BASE_SHA" ]; then refuse (the base drifted)
//   :89  git -C "$REPO" checkout -q "$BASE_BRANCH"
// With BASE_BRANCH = a sha:
//   * :84 is a tautology (rev-parse <sha> == BASE_SHA) → the base-drift
//     guard can never fire — the very defect the diff repaired on the head
//     side;
//   * :89 checks out a SHA → a DETACHED HEAD → the --no-ff merge commit is
//     created on a dangling head and the base BRANCH never advances: the
//     rail prints "merge: accepted — … merged" and nothing merged onto the
//     branch the PR targets.
//
// The repro drives the REAL door (the gate ON — the default; the gate's own
// resolution of `--base main` is the sha), then the REAL merge.sh, and
// asserts the base branch carries the accepted head.
//
// BASE behaviour: the door was handed the REF (`base: val("base")`) → the
// checkout lands on the branch and the merge advances it → the assertion
// holds on BASE, so this is an INTRODUCED regression.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")
const STUB = join(import.meta.dirname, "..", "orchestrator-stub.mjs")

test("questions-25: the accept must advance the base BRANCH (BASE_BRANCH must be a ref, not a sha)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q25-base-"))
  const repo = join(tmp, "repo")
  const home = join(tmp, "home")
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(home, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const isAncestor = (a: string, b: string): boolean => {
    try {
      g("merge-base", "--is-ancestor", a, b)
      return true
    } catch {
      return false
    }
  }
  try {
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    const baseSha = g("rev-parse", "main").trim()
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const headSha = g("rev-parse", "HEAD").trim()

    // the REAL door, the gate ON (the default): it resolves `--base main`
    // to the base sha and hands THAT down (bin/whitehartlane:600)
    const out = join(tmp, "prog")
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", out],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          AGENTIC_OS_ORCHESTRATOR: STUB,
          AGENTIC_OS_NOTIFY: "0",
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    )
    assert.ok(existsSync(join(out, "data", "review", "config.sh")), `the door must materialize the program (stderr: ${r.stderr})`)
    const cfg = execFileSync("cat", [join(out, "data", "review", "config.sh")], { encoding: "utf8" })

    // the real merge gate, the LOCAL arm (no MERGE_CMD): the accept must
    // advance the base branch
    mkdirSync(join(tmp, "run"), { recursive: true })
    writeFileSync(
      join(out, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }),
    )
    const m = spawnSync("bash", [join(out, "hooks", "merge.sh")], { cwd: join(tmp, "run"), encoding: "utf8" })
    const mainNow = g("rev-parse", "main").trim()
    assert.ok(
      isAncestor(headSha, "main"),
      `the accept must advance the base BRANCH main (base ${baseSha.slice(0, 12)} → now ${mainNow.slice(0, 12)}); with BASE_BRANCH=<sha> the merge checked out a DETACHED HEAD, so "merge: accepted" was printed while nothing merged onto the branch.\nstdout: ${m.stdout}\nstderr: ${m.stderr}`,
    )
    assert.match(
      cfg,
      /^BASE_BRANCH='main'$/m,
      `BASE_BRANCH must be the base REF — merge.sh compares it with BASE_SHA (merge.sh:84) and checks it out (merge.sh:89); a sha there makes the base-drift guard a tautology and the merge land on a detached HEAD.\nconfig.sh:\n${cfg}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
