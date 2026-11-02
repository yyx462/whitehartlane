// momentum-3102 — the UNANSWERED-P0 CHECK compares the P0's file
// against the CURRENT round's reading start, so once the rounds go
// delta it refuses P0s that were already answered.
//
// The guard (templates/pr-review/hooks/merge.sh):
//
//   p0_from="$(node -e '… v.judgedFrom || BASE_SHA …' verdict.json)"
//   for p0_file in $p0_files; do
//     if ! git diff --quiet "$p0_from" "$judged_head" -- "$p0_file"; then continue; fi
//     echo "merge: an UNANSWERED P0 rides the merge — $p0_file was P0-flagged by a prior round and its bytes are unchanged since this reading began ($p0_from); fix it or overrule"
//     exit 1
//   done
//
// p0_from is THIS verdict's judgedFrom — the start of THIS round's
// reading. The question the guard means to ask is "was the P0
// ANSWERED?" — i.e. "did the P0's file change AFTER THE P0 WAS
// FLAGGED". Once an accept has vouched for the bytes, the door's span
// resolution (src/doors/review.ts — "the newest prior verdict
// ACCEPTED at hA → the round reads the delta hA..head") makes
// judgedFrom = the accept's head, so the comparison window shrinks to
// the delta and no longer contains the FIX:
//
//   round 1  reject  (a P0 was PROVEN in x.ts)      judgedFrom = base
//   round 2  accept  (the author fixed x.ts)         judgedFrom = base
//   round 3  accept  (a delta round after the vouch)  judgedFrom = H2
//
// Round 3's window is H2..H3 — x.ts does not change there (it was
// fixed BEFORE H2), so the guard concludes "its bytes are unchanged
// since this reading began" and refuses the merge with "fix it or
// overrule" for a file that WAS fixed — and the round after that
// refuses again, forever (the accept's head is the new judgedFrom,
// and x.ts never changes again).
//
// The guard's own claim is false: "untouched since this reading began"
// does not mean "never fixed". The comparison must start at the P0's
// OWN round, not at the current round's reading start.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MERGE = join(ROOT, "templates", "pr-review", "hooks", "merge.sh")

const g = (repo: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("the P0 guard: a P0 that was FIXED before the accept must not block the delta round's merge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-momentum-3102-"))
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
    // round 1's head: the P0 was proven in x.ts here
    g(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "other.ts"), "export const other = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "r1")
    const h1 = g(repo, "rev-parse", "HEAD")
    // round 2: the author FIXED x.ts — this is where the P0 was answered
    writeFileSync(join(repo, "x.ts"), "export const x = 2\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "fix")
    const h2 = g(repo, "rev-parse", "HEAD")
    // round 3: a delta round after the accept vouched for H2
    writeFileSync(join(repo, "more.ts"), "export const more = 1\n")
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
        // the delta round's reading starts at the accept's head (H2)
        `JUDGED_SPAN_FROM='${h2}'`,
        // every judged span: round 1 (base..H1), round 2 (base..H2), this round (H2..H3)
        `JUDGED_SPANS='${base}:${h1} ${base}:${h2} ${h2}:${h3}'`,
        // round 1 flagged a P0 in x.ts; round 2 found nothing
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
      `INV-4: x.ts was P0-flagged in round 1 and FIXED in round 2 (the accept at ${h2.slice(0, 8)} vouched for it); this delta round's reading starts at ${h2.slice(0, 8)}, so the guard's window (${h2.slice(0, 8)}..${h3.slice(0, 8)}) no longer contains the fix and the guard reports a P0 that was answered. The comparison must start at the P0's OWN round, not at the current round's reading start. stderr: ${r.stderr.trim()}`,
    )
    assert.match(`${r.stdout}${r.stderr}`, /accepted/, "the merge ran")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
