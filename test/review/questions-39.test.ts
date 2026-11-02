// questions-39 (questions lens, Q2/Q5) — merge.sh's ref-sweep arm is
// VACUOUS: it can never observe a move.
//
// templates/pr-review/hooks/merge.sh, the arm this diff ADDS
// (merge.sh:93-104):
//
//   `drifted=""`
//   `for ref in $(git -C "$REPO" for-each-ref --points-at "$judged_head" …); do`
//   `  now="$(git -C "$REPO" rev-parse "$ref" …)"`
//   `  if [ -n "$now" ] && [ "$now" != "$judged_head" ]; then`
//   `    drifted="$drifted $ref($now)"`
//   `  fi`
//   `done`
//   `if [ -n "$drifted" ]; then … exit 1; fi`
//
// `for-each-ref --points-at <sha>` enumerates the refs that STILL
// point at <sha>. Every ref it returns therefore satisfies
// `rev-parse <ref> == <sha>` BY CONSTRUCTION — so `[ "$now" !=
// "$judged_head" ]` is never true and the arm is DEAD.
//
// The diff's own comment three lines above (merge.sh:61-65) says so
// and then ships it anyway:
//
//   "THE BRANCH HALF (questions-2 / tests-1): HEAD_BRANCH is the
//    branch NAME (the door derives it from the judged sha ✓) — ask
//    where it points NOW. The earlier ref-sweep arm was vacuous:
//    `for-each-ref --points-at` lists only refs that STILL point at
//    the judged sha, so it could never observe a move."
//
// The reachable shape the arm was supposed to catch: the door could
// not NAME the reviewed branch (two refs sit at the judged sha, so
// branchOf answers "no name" — review.ts:1603-1612), so HEAD_BRANCH
// is empty and the BRANCH HALF is skipped; the PR's remote head still
// holds the judged sha (the push has not landed); and the LOCAL
// branch has moved — the exact "the branch moved since the review"
// the arm's own refusal message claims to catch.
//
// BASE behaviour: BASE's merge.sh has no drift guard of this shape,
// so this is an incomplete-fix case — the diff ADDS the arm and the
// arm cannot fire.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MERGE_SH = join(import.meta.dirname, "..", "..", "templates", "pr-review", "hooks", "merge.sh")

const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

test("merge.sh's ref-sweep sees a ref that pointed at the judged sha and has since moved", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-refsweep-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const base = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")
    const head = g("rev-parse HEAD").trim()
    // a SIBLING at the judged sha — the door cannot name the reviewed
    // branch (branchOf answers "no name" for two refs), so HEAD_BRANCH
    // is empty and the ref-sweep is the only local witness
    g("branch sibling " + head)
    // the reviewed branch MOVED after the review
    g("checkout -q feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false // moved\n")
    g("commit -qam moved")
    g("checkout -q main")

    const dir = join(tmp, "prog")
    mkdirSync(join(dir, "hooks"), { recursive: true })
    mkdirSync(join(dir, "data", "review"), { recursive: true })
    writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(MERGE_SH, "utf8"))
    writeFileSync(
      join(dir, "data", "review", "config.sh"),
      [
        `REPO=${sq(repo)}`,
        `BASE_BRANCH=${sq("main")}`,
        `BASE_SHA=${sq(base)}`,
        `HEAD_BRANCH=${sq("")}`,
        `HEAD_SHA=${sq(head)}`,
        `TITLE=${sq("t")}`,
        `MERGE_CMD=${sq("true")}`,
        `PR_NUM=${sq("42")}`,
        "",
      ].join("\n"),
    )
    writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))
    // the PR's remote head is still the judged sha (the push has not
    // landed) — the remote witness agrees, the LOCAL branch moved
    const ghDir = join(tmp, "ghbin")
    mkdirSync(ghDir, { recursive: true })
    const gh = join(ghDir, "gh")
    writeFileSync(gh, `#!/bin/sh\ncase "$1 $2" in "pr view") echo ${head} ;; esac\nexit 0\n`)
    chmodSync(gh, 0o755)

    const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${ghDir}:${process.env.PATH}` },
    })
    assert.notEqual(
      r.status,
      0,
      `a ref that pointed at the judged sha and has since moved must refuse — the arm the diff adds claims exactly this ("the branch moved since the review") (stderr: ${r.stderr})`,
    )
    assert.match(r.stderr, /moved/, "the refusal names the moved ref")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
