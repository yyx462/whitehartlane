// momentum-3002 — a delta round's ACCEPT must not merge a span an
// earlier verdict REJECTED.
//
// The change makes a round read only the commits since the last judged
// head (src/doors/review.ts:769-778, the DELTA ROUNDS block) and
// stamps the span it read on the verdict (templates/pr-review/hooks/
// prove.sh: `judgedFrom: process.env.JUDGED_SPAN_FROM`).
//
// The merge gate still decides with the LAST verdict alone: it reads
// `$prog/data/review/verdict.json` (templates/pr-review/hooks/merge.sh
// :36) and its accept arm merges on that verdict's word. The NEW chain
// check (merge.sh:141-165) proves the TILING — the judged spans fold
// forward from BASE_SHA to the judged head — but tiling is a statement
// about READS, never about OUTCOMES: a span that was read and REJECTED
// tiles exactly as well as a span that was read and accepted.
//
// So the byte-level guarantee the gate states for itself
// (bin/whitehartlane:843 — "the merged bytes ARE the judged bytes")
// and the vocabulary it refuses with (merge.sh:133 — "the merge would
// land bytes no verdict judged") both break at the new seam: the
// verdict that says "accept" now speaks only for its own span, while
// the gate merges base..head.
//
// The information is already AT THE SEAT: the door hands the prior
// rounds' buckets and their P0 flag down in STOP_HISTORY
// (src/doors/review.ts:1121-1123 → config.sh) and the accept arm
// never reads it.
//
// The repro drives the REAL merge.sh on a fixture whose history says
// exactly this:
//   base → h1 (the P0's code lands here, verdict@base..h1 = REJECT,
//             one P0, the bucket handed down in STOP_HISTORY)
//        → h2 (unrelated work; the P0's code is UNCHANGED at h2)
//   the delta round at h2 read only h1..h2 and found nothing → its
//   verdict says "accept" (the seat's verdict.json)
//   the judged spans tile perfectly: "base:h1 h1:h2"
// The gate must not land the P0's bytes.
//
// BASE behaviour: the base gate has no chain check and no delta rounds;
// it merges on the same accept verdict → the assertion fails on BASE
// too, and the diff touches templates/pr-review/hooks/merge.sh → the
// prove gate classifies this as an incomplete-fix.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MERGE_SH = join(ROOT, "templates", "pr-review", "hooks", "merge.sh")

test("an accept verdict scoped to the last span must not merge a span an earlier verdict REJECTED", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3002-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    // the trunk
    writeFileSync(join(repo, "src", "ok.ts"), "export const ok = 1\n")
    g("add -A")
    g("commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    // h1 — the P0's code lands here and is NEVER fixed
    writeFileSync(join(repo, "src", "bug.ts"), "export const bug = 1 // the P0 lives here\n")
    g("add -A")
    g("commit -qm 'the P0'")
    const head1 = g("rev-parse HEAD").trim()
    // h2 — unrelated work; the P0's bytes are unchanged
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A")
    g("commit -qm 'unrelated work'")
    const head2 = g("rev-parse HEAD").trim()

    // the bug's bytes are STILL in the head — the P0 was not fixed
    const bugStillThere = g(`show ${head2}:src/bug.ts`).includes("the P0 lives here")
    assert.ok(bugStillThere, "fixture: the P0's code is unchanged at the judged head")

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
        `HEAD_SHA='${head2}'`,
        `TITLE='t'`,
        `MERGE_CMD='touch ${marker}'`,
        // the tiling is PERFECT: round 1 judged base..h1, round 2 judged
        // h1..h2 — no gap, so the chain check is not what refuses here
        `JUDGED_SPANS='${baseSha}:${head1} ${head1}:${head2}'`,
        // the door's own hand-down: round 1 carried a P0 (bucket + flag)
        `STOP_HISTORY='[{"buckets":["bug.ts:0"],"p0":true}]'`,
        `STOP_CFG='{"rounds":2,"novelMax":1,"minRounds":2}'`,
        "",
      ].join("\n"),
    )
    // the seat's verdict: the DELTA round at h2 (read h1..h2 only) found
    // nothing → accept
    writeFileSync(
      join(dir, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", repo, base: baseSha, judgedFrom: head1, head: head2, blocked: [], advisory: [] }),
    )

    const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8", timeout: 60_000 })
    const merged = existsSync(marker)
    assert.ok(
      !merged,
      `INV-4: the gate merged a PR whose earlier judged span carried an UNFIXED, UNANSWERED P0 (round 1 at ${head1.slice(0, 8)} rejected with it; its bytes are unchanged at the judged head ${head2.slice(0, 8)}; STOP_HISTORY names the bucket and the P0 flag). The accept verdict speaks only for the delta span (judgedFrom ${head1.slice(0, 8)}), the spans tile perfectly, and the gate merges base..head anyway — "the merged bytes ARE the judged bytes" (bin/whitehartlane:843) no longer holds. stderr: ${r.stderr}`,
    )
    assert.notEqual(r.status, 0, `the gate must refuse (stderr: ${r.stderr})`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
