// principles-3102 — the diff must not REPLACE another finding's adopted repro.
//
// The diff carries TWO files (data/review/files-all.txt):
//   src/doors/ship-supervisor.ts        <- the PR's own change
//   test/review/momentum-3102.test.ts   <- NOT claimed by pr.md
//
// The second file is not a new test. At BASE it is the ADOPTED repro
// of r269's finding momentum-3102 — "the P0 guard: a P0 that was FIXED
// before the accept must not block the delta round's merge" — the pin
// for templates/pr-review/hooks/merge.sh's unanswered-P0 arm (the arm
// that BLOCKS a merge). At HEAD the very same path holds a DIFFERENT
// test (the --problem key), so the diff:
//
//   1. DELETED live coverage: the P0-window law (a P0 flagged in round
//      1 and fixed in round 2 must not block round 3's merge) is
//      pinned by no other adopted test — momentum-3002 pins the
//      OPPOSITE (a P0 whose bytes did NOT change MUST block) and
//      tests-10508 pins the fix landing INSIDE the current reading;
//      the deleted case is the fix landing in an EARLIER round, which
//      is exactly where the guard's window goes blind.
//   2. COLLIDED the finding id: "momentum-3102" now names two
//      different findings (r269's P0-window pin and this PR's
//      --problem key), so the ledger that addresses a finding by id
//      can no longer tell them apart.
//
// The repo's own laws: AGENTS.md — "a fix without its adopted test has
// not happened", "ONE SEAM PER PR" (a PR carries one mechanism change;
// everything else goes to its OWN PR or a ticket), the fixer's law
// "SIDE-NOTES ARE TRIAGED, NEVER DROPPED".
//
// BASE: the adopted repro is in place and PASSES (it was live coverage,
// not a stale test for already-fixed behaviour) → test A passes on
// BASE (introduced by this diff).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MERGE = join(ROOT, "templates", "pr-review", "hooks", "merge.sh")
const ADOPTED = join(ROOT, "test", "review", "momentum-3102.test.ts")

const g = (repo: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("finding momentum-3102's adopted repro must still pin the P0-window law", () => {
  const src = readFileSync(ADOPTED, "utf8")
  assert.match(
    src,
    /pr-review[\s\S]{0,200}merge\.sh/,
    `test/review/momentum-3102.test.ts must remain the ADOPTED repro of finding momentum-3102 — the pin for the merge gate's unanswered-P0 arm ("a P0 that was FIXED before the accept must not block the delta round's merge"). The diff replaced that file's whole content with an unrelated test (the --problem key) under the SAME finding id: the P0-window law now has no adopted pin, and the id names two different findings.`,
  )
  assert.match(
    src,
    /"p0":\s*true/,
    "the adopted repro must carry a P0-flagged stop history (it is the pin for the unanswered-P0 guard)",
  )
  assert.match(
    src,
    /status,\s*0/,
    "the adopted repro must expect the merge to be ALLOWED (the law: a P0 answered in an EARLIER round must not block this round's merge)",
  )
})

test("the P0-window law itself still holds (the deleted pin was LIVE coverage, not stale)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-3102-"))
  const repo = join(tmp, "repo")
  const prog = join(tmp, "prog")
  try {
    mkdirSync(repo, { recursive: true })
    g(repo, "init", "-q", "-b", "main", ".")
    g(repo, "config", "user.email", "t@t.local")
    g(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "x.ts"), "export const x = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "base")
    const base = g(repo, "rev-parse", "main")
    g(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "other.ts"), "export const other = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "r1")
    const h1 = g(repo, "rev-parse", "HEAD")
    writeFileSync(join(repo, "x.ts"), "export const x = 2\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "fix")
    const h2 = g(repo, "rev-parse", "HEAD")
    writeFileSync(join(repo, "more.ts"), "export const other = 2\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "r3")
    const h3 = g(repo, "rev-parse", "HEAD")

    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    copyFileSync(MERGE, join(prog, "hooks", "merge.sh"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${base}'`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA='${h3}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD=''`,
        `PR_NUM=''`,
        `STAGED_DIR='${prog}'`,
        `JUDGED_SPAN_FROM='${h2}'`,
        `JUDGED_SPANS='${base}:${h1} ${base}:${h2} ${h2}:${h3}'`,
        `STOP_HISTORY='[{"buckets":["x.ts:0"],"p0":true},{"buckets":[],"p0":false}]'`,
        `STOP_CFG='{"rounds":2,"novelMax":1,"minRounds":2}'`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", repo, base, judgedFrom: h2, head: h3, blocked: [], advisory: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: prog, encoding: "utf8", timeout: 60_000 })
    assert.equal(
      r.status,
      0,
      `x.ts was P0-flagged in round 1 and FIXED in round 2; the delta round's reading starts at ${h2.slice(0, 8)}, so the guard must compare against the P0's OWN round, not this round's reading start. stderr: ${r.stderr.trim()}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
