// tests-10508 — the merge stage's NEW unanswered-P0 check compares the WRONG
// FILE.
//
// The diff adds this check to templates/pr-review/hooks/merge.sh's accept
// arm (momentum-3002, r22):
//
//   p0_files="$(node -e '
//     const h = JSON.parse(process.argv[1])
//     const files = new Set()
//     for (const round of h) if (round.p0) for (const b of round.buckets) files.add(b.split(":")[0])
//     console.log([...files].join(" "))' "$STOP_HISTORY")"
//   ...
//   for p0_file in $p0_files; do
//     if ! git -C "$REPO" diff --quiet "$p0_from" "$judged_head" -- "$p0_file"; then continue; fi
//     echo "merge: an UNANSWERED P0 rides the merge — $p0_file ..." >&2
//     exit 1
//   done
//
// Its stated law (the code's own words):
//
//   "A p0-flagged bucket's FILE untouched since that point was never fixed
//    and never overruled — an accept that speaks only for its span cannot
//    carry it."
//   "Fixed = the file changed after the reading began"
//
// The bucket is NOT a path: src/doors/stop-rule.ts's bucketOf() keeps only
// the BASENAME (`(b.location?.file ?? "?").split("/").pop()`), so the file
// the check compares is "review.ts", not "src/doors/review.ts".  A git
// pathspec without a slash is matched against the path RELATIVE TO THE REPO
// ROOT (`git diff A B -- review.ts` never matches `src/doors/review.ts`) —
// so for every finding that lives in a subdirectory the pathspec matches
// NOTHING, `git diff --quiet` reports "no differences", and the gate
// refuses EVERY accept with "an UNANSWERED P0 rides the merge" — even
// when the P0's file was FIXED inside the round's own reading.
//
// The prior round's repro (test/review/momentum-3002.test.ts) pins the
// refusal and therefore PASSES FOR THE WRONG REASON: its P0 file is
// src/bug.ts and its bucket is "bug.ts:0" — the very mismatch this test
// isolates.  The complement (the P0 FIXED) is the case nobody pinned.
//
// This test drives the REAL merge.sh twice over the SAME policy, with the
// ONLY difference being where the P0's file lives:
//   case A — the P0's file is bug.ts at the REPO ROOT and it WAS FIXED in
//            the round: the merge must PROCEED (the control);
//   case B — the P0's file is src/doors/review.ts and it WAS FIXED in the
//            round: the accept speaks for it (it is in the round's diff),
//            so the merge must PROCEED too.
// If A merges and B refuses, the difference is the pathspec, not the law.
//
// INV-4 (verdicts are honest): the merge gate's own verdict ("an
// UNANSWERED P0 rides the merge") is false for case B — the P0 was
// answered — and the gate refuses a merge the accept covered.  Every PR
// that ever collected a P0 in a subdirectory file can never merge through
// the gate again.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MERGE_SH = join(ROOT, "templates", "pr-review", "hooks", "merge.sh")

type Case = {
  /** where the P0's file lives */
  p0File: string
  /** the bucket the door's hand-down carries (the BASENAME — the lossy seat) */
  bucket: string
}

// build the whole world: a repo whose P0 was FIXED inside the round the
// accept speaks for, plus the gate's fixture
function build(tmp: string, c: Case): { repo: string; marker: string; head: string } {
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src", "doors"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "keep.ts"), "export const keep = 1\n")
  g("add -A")
  g("commit -qm base")
  const baseSha = g("rev-parse main").trim()
  g("checkout -qb feat")
  // h1 — the P0's file LANDS with the bug in it
  const p0Abs = join(repo, c.p0File)
  mkdirSync(join(p0Abs, ".."), { recursive: true })
  writeFileSync(p0Abs, "export const bug = 1 // the P0 lives here\n")
  writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
  g("add -A")
  g("commit -qm 'the P0 lands'")
  // h2 — the P0's file is FIXED (this is the round the accept speaks for)
  writeFileSync(p0Abs, "export const bug = 2 // fixed\n")
  writeFileSync(join(repo, "src", "third.ts"), "export const third = 1\n")
  g("add -A")
  g("commit -qm 'the P0 is fixed'")
  const head = g("rev-parse HEAD").trim()

  const marker = join(tmp, "merged.txt")
  const dir = join(tmp, "gate")
  mkdirSync(join(dir, "hooks"), { recursive: true })
  mkdirSync(join(dir, "data", "review"), { recursive: true })
  writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(MERGE_SH, "utf8"))
  writeFileSync(
    join(dir, "data", "review", "config.sh"),
    [
      `REPO='${repo}'`,
      `BASE_BRANCH='main'`,
      `BASE_SHA='${baseSha}'`,
      `HEAD_BRANCH='feat'`,
      `HEAD_SHA='${head}'`,
      `TITLE='t'`,
      `MERGE_CMD='touch ${marker}'`,
      `JUDGED_SPANS='${baseSha}:${head}'`,
      // the door's own hand-down: the prior round carried a P0
      `STOP_HISTORY='[{"buckets":["${c.bucket}"],"p0":true}]'`,
      `STOP_CFG='{"rounds":2,"novelMax":1,"minRounds":2}'`,
      "",
    ].join("\n"),
  )
  // the round's verdict: accept, and it READ the fixed file (judgedFrom =
  // the base — the delta law's unresolved era: no accept has vouched yet,
  // so the round reads the whole span, the fix included)
  writeFileSync(
    join(dir, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "accept", repo, base: baseSha, judgedFrom: baseSha, head, blocked: [], advisory: [] }),
  )
  return { repo, marker, head }
}

test("tests-10508: the unanswered-P0 check must compare the P0's FILE — a fixed P0 must not block the merge", () => {
  const results: string[] = []
  // the CONTROL first (the P0's file at the repo root — the pathspec
  // resolves, the file was fixed, the merge proceeds), then the case
  // under test (the same law, the P0's file in a subdirectory)
  for (const c of [
    { p0File: "bug.ts", bucket: "bug.ts:0" },
    { p0File: "src/doors/review.ts", bucket: "review.ts:0" },
  ]) {
    const tmp = mkdtempSync(join(tmpdir(), "aos-t10508-"))
    try {
      const { marker, head } = build(tmp, c)
      const r = spawnSync("bash", [join(tmp, "gate", "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8", timeout: 60_000 })
      const merged = existsSync(marker)
      results.push(
        `  ${c.p0File} (bucket ${c.bucket}): merged=${merged} status=${r.status} stderr=${JSON.stringify(r.stderr.slice(-260))}`,
      )
      if (c.p0File === "bug.ts") {
        // the CONTROL: the same law, the P0's file at the repo root — the
        // pathspec resolves, the file was fixed, the merge must proceed
        assert.ok(
          existsSync(marker),
          `fixture sanity: the control case (the P0's file at the repo root, fixed in the round) must merge — stderr: ${r.stderr}`,
        )
      }
      if (c.p0File === "src/doors/review.ts") {
        assert.ok(
          existsSync(marker),
          `INV-4: the P0's file (${c.p0File}) was FIXED inside the round the accept speaks for — it is in the round's own diff ` +
            `(judgedFrom = the base), so the accept covers it and the merge must proceed. The gate refused with a FALSE verdict: ` +
            `"an UNANSWERED P0 rides the merge" for a P0 that was answered. The cause: the bucket is the BASENAME (${c.bucket}), and ` +
            `git matches a slashless pathspec against the path relative to the REPO ROOT — "review.ts" never matches ` +
            `"src/doors/review.ts", so \`git diff --quiet -- review.ts\` finds nothing and the gate reads that as "untouched".\n` +
            results.join("\n"),
        )
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})
