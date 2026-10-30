// momentum-909 — the merge stage must RECORD its refusal, not only its
// merge.
//
// The change adds the outcome marker (templates/pr-review/hooks/merge.sh):
//
//   outcome() { # $1 = accept|reject
//     payload="{\"outcome\":\"$1\",…}"
//     printf '%s\n' "$payload" >>"$prog/data/review/merge.json" || true
//     local seat="${STAGED_DIR:-$prog}/data/review/merge.json"
//     printf '%s\n' "$payload" >"$seat" || true
//   }
//
// and the diff's own law for it (merge.sh:11-16, principles-4004):
//
//   "THE OUTCOME MARKER (principles-4004): the commission ends with THIS
//    stage — the verdict the prove stage wrote lands two stages earlier,
//    so a watcher waiting on the verdict speaks before the feedback map
//    exists and before the merge ran. The merge stage writes the
//    commission's end into the STAGED program dir, and the watcher waits
//    on exactly that seat."
//
// But `outcome` is called from exactly TWO arms of the case (merge.sh:94
// accept, merge.sh:99 reject). The merge stage has EIGHT other exits:
//
//   :48  the reviewed tree moved (worktree head != judged head)
//   :60  a ref that pointed at the judged sha moved
//   :66  the PR's head could not be read (gh unverified)
//   :70  the PR is at a different head than the verdict judged
//   :78  MERGE_CMD failed
//   :87  the base branch moved
//   :89  cannot check out the base branch
//   :91  the git merge failed (conflicts)
//   :109 the verdict.json says neither accept nor reject ("refuse, never
//        guess")
//
// Every one of those REFUSES — a definite, observed END of the
// commission — and none of them writes the marker. So the seat the
// watcher polls stays EMPTY on every refusal path, and the marker cannot
// tell "the merge stage refused" from "the merge stage never ran": the
// watcher's `V=$(sed … merge.json)` extraction yields the empty string
// and the PR is told "ship-gate: unknown — the supervisor did not post;
// the outcome is at …/merge.json" — pointing at a file that will never
// exist.
//
// That is not a hypothetical arc: the head-drift guard (this diff's own
// new code, :46-71) refuses exactly here — a push during the review is
// the case the guard exists for, and the PR then hears "unknown" (or, if
// the verdict-seat break is also present, a two-hour timeout) instead of
// "the branch moved, re-review". INV-4: a refusal reported as "unknown"
// is an honest-verdict violation — the merge stage KNOWS the outcome.
//
// The repro drives the REAL template hook at its REAL seat with a
// verdict.json that says accept and a MERGE_CMD that fails, and asserts
// the staged seat carries the outcome. The success arm is the control:
// it must still write accept.
//
// BASE behaviour: BASE's merge.sh has no marker at all → the assertion
// fails on BASE too, and the diff DOES touch
// templates/pr-review/hooks/merge.sh → the prove gate classifies this as
// an incomplete-fix.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")
const MERGE_HOOK = join(TEMPLATES, "pr-review", "hooks", "merge.sh")

// A staged program dir with the hook at its real seat: the hook resolves
// `prog` as its own parent, so the program's data/ must sit beside it.
// `staged` is the seat the watcher polls (STAGED_DIR).
function stagedProgram(verdict: Record<string, unknown>, mergeCmd: string) {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom909-"))
  const prog = join(tmp, "prog")
  const staged = join(tmp, "staged")
  const repo = join(tmp, "repo") // the merge command runs with cwd = REPO
  mkdirSync(join(prog, "hooks"), { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  mkdirSync(join(staged, "data", "review"), { recursive: true })
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(MERGE_HOOK, "utf8"))
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO='${repo}'`,
      `BASE_BRANCH='main'`,
      `BASE_SHA='${"a".repeat(40)}'`,
      `HEAD_BRANCH='feat'`,
      `HEAD_SHA='${"b".repeat(40)}'`,
      `TITLE='t'`,
      `AUTHOR=''`,
      `MERGE_CMD='${mergeCmd}'`,
      `PR_NUM=''`,
      `STAGED_DIR='${staged}'`,
      "",
    ].join("\n"),
  )
  writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify(verdict))
  return { tmp, prog, staged }
}

const runHook = (prog: string) =>
  spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
    cwd: prog,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
  })

const seat = (staged: string) => join(staged, "data", "review", "merge.json")

test("a REFUSED merge still lands its outcome at the seat the watcher waits on", () => {
  const { tmp, prog, staged } = stagedProgram(
    { verdict: "accept", head: "b".repeat(40), blocked: [] },
    // the merge itself fails — the commission ends HERE, definitively
    "exit 3",
  )
  try {
    const r = runHook(prog)
    assert.notEqual(r.status, 0, `the merge stage must refuse when the merge fails (stdout: ${r.stdout}; stderr: ${r.stderr})`)
    assert.ok(
      existsSync(seat(staged)),
      `the merge stage REFUSED (stderr: ${r.stderr.trim()}) but wrote NO outcome at the seat the watcher waits on ` +
        `(STAGED_DIR/data/review/merge.json) — the seat cannot tell "the merge stage refused" from "still running", ` +
        `so the watcher reports "unknown" (or a 2h timeout) for a commission that ended in seconds`,
    )
    const marker = JSON.parse(readFileSync(seat(staged), "utf8").trim())
    assert.ok(
      typeof marker.outcome === "string" && marker.outcome.length > 0,
      `the marker must name the outcome that happened (got ${JSON.stringify(marker)})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("CONTROL: the accept arm still writes accept at the same seat", () => {
  const { tmp, prog, staged } = stagedProgram(
    { verdict: "accept", head: "b".repeat(40), blocked: [] },
    "true", // the merge succeeds
  )
  try {
    const r = runHook(prog)
    assert.equal(r.status, 0, `the accept arm must succeed (stdout: ${r.stdout}; stderr: ${r.stderr})`)
    assert.ok(existsSync(seat(staged)), "the accept arm must write the outcome at the seat")
    const marker = JSON.parse(readFileSync(seat(staged), "utf8").trim())
    assert.equal(marker.outcome, "accept")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
