// momentum-3100 — the CHAIN CHECK (the judged-spans tiling) must not
// invent a GAP when the trunk moved between rounds.
//
// The merge gate folds the judged spans forward from BASE_SHA:
//
//   span_frontier="$BASE_SHA"
//   while [ "$span_progress" = "1" ]; do
//     span_progress=0
//     for span_pair in $JUDGED_SPANS; do
//       span_f="${span_pair%%:*}"; span_h="${span_pair##*:}"
//       if [ "$span_f" != "$span_frontier" ] && ! git merge-base --is-ancestor "$span_f" "$span_frontier"; then continue; fi
//       if git merge-base --is-ancestor "$span_h" "$span_frontier"; then continue; fi
//       span_frontier="$span_h"; span_progress=1
//     done
//   done
//
// The advance test is "span_h is NOT an ancestor of the frontier". It
// never asks whether span_h DESCENDS from the frontier, so the frontier
// can move BACKWARD onto a span head that sits on another line.
//
// The trunk moving between rounds is the ordinary case (prepareReview
// refuses a base that is not an ancestor of the head, so the author
// MERGES the moved trunk into the branch). Then:
//
//   round 1 judged  B1..H1      (the old trunk tip B1)
//   round 2 judged  B2..H2      (the new trunk tip B2, H2 = merge(H1,B2))
//   JUDGED_SPANS = "B1:H1 B2:H2", BASE_SHA = B2
//
// The fold: frontier=B2 → span (B1,H1): B1 is an ancestor of B2, and H1
// is not an ancestor of B2 → frontier := H1  (BACKWARD — H1 does not
// descend from B2). Span (B2,H2): B2 is not an ancestor of H1 → skipped.
// The frontier never reaches H2 → "the judged spans leave a GAP".
//
// But there is NO gap: round 2 read exactly B2..H2 — the PR's whole
// diff against the current trunk (JUDGED_SPAN_FROM = B2) — so every
// byte the merge would land was judged. The guard's own claim ("a GAP
// is bytes no verdict judged") is false here, and the accept refuses a
// merge it must allow. On BASE (no chain check at all) the same fixture
// merges cleanly.
//
// The fold's advance test must be "the frontier is an ancestor of
// span_h" (span_h DESCENDS from the frontier), never merely "span_h is
// not an ancestor of the frontier".
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

test("the chain check: a trunk that moved between rounds is not a GAP — the accept must merge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-momentum-3100-"))
  const repo = join(tmp, "repo")
  const prog = join(tmp, "prog")
  try {
    mkdirSync(repo, { recursive: true })
    g(repo, "init", "-q", "-b", "main", ".")
    g(repo, "config", "user.email", "t@t.local")
    g(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "a.txt"), "a\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "A")
    const b1 = g(repo, "rev-parse", "main")
    // round 1: the PR branch with one commit — the head round 1 judged
    g(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "f.txt"), "f\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "F1")
    const h1 = g(repo, "rev-parse", "HEAD")
    // the trunk MOVES (the ordinary case in an active repo)
    g(repo, "checkout", "-q", "main")
    writeFileSync(join(repo, "b.txt"), "b\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "B")
    const b2 = g(repo, "rev-parse", "main")
    // the author merges the moved trunk into the branch (prepareReview
    // refuses a base that is not an ancestor of the head)
    g(repo, "checkout", "-q", "feat")
    g(repo, "merge", "-q", "--no-edit", "-m", "merge trunk", "main")
    const h2 = g(repo, "rev-parse", "HEAD")

    // the staged program the merge gate runs in
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    copyFileSync(MERGE, join(prog, "hooks", "merge.sh"))
    // the config the door hands down: BASE_SHA is the CURRENT trunk tip,
    // JUDGED_SPAN_FROM is where THIS round's reading began (B2 — round 2
    // re-read the whole span because no accept vouched for it yet), and
    // JUDGED_SPANS is every judged span: round 1's (B1..H1) and this
    // round's (B2..H2)
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${b2}'`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA='${h2}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD=''`,
        `PR_NUM=''`,
        `STAGED_DIR='${prog}'`,
        `JUDGED_SPAN_FROM='${b2}'`,
        `JUDGED_SPANS='${b1}:${h1} ${b2}:${h2}'`,
        `STOP_HISTORY='[]'`,
        `STOP_CFG='{"rounds":2,"novelMax":1,"minRounds":2}'`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", repo, base: b2, judgedFrom: b2, head: h2, blocked: [], advisory: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: prog, encoding: "utf8", timeout: 60_000 })
    assert.equal(
      r.status,
      0,
      `INV-4: the accept must merge — round 2 judged exactly BASE_SHA..HEAD_SHA (${b2.slice(0, 8)}..${h2.slice(0, 8)}), so no unjudged byte rides the merge. The chain check refused with a GAP it invented by folding the frontier BACKWARD onto round 1's head (${h1.slice(0, 8)}), which does not descend from the new trunk tip (${b2.slice(0, 8)}). stderr: ${r.stderr.trim()}`,
    )
    assert.match(`${r.stdout}${r.stderr}`, /accepted/, "the merge ran")
    const trunk = g(repo, "rev-parse", "main")
    assert.notEqual(trunk, b2, "the trunk actually took the merge")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the chain check: two judged spans with DIVERGENT heads must not spin the fold forever", () => {
  // the same defect, second consequence: the frontier can also OSCILLATE.
  // Two judged heads on divergent lines (X and Y — the PR merged another
  // branch), both ancestors of the judged head M:
  //
  //   pass 1: (A:X) -> frontier=X ; (A:Y) -> frontier=Y ; (X:M) skipped
  //           (X does not descend from Y)
  //   pass 2: (A:X) -> frontier=X ; (A:Y) -> frontier=Y ; (X:M) skipped
  //   … forever. The merge gate NEVER RETURNS: the chain's last stage
  //   spins, the commission never ends, the PR never hears (the
  //   supervisor burns its 2h deadline and reports a timeout).
  const tmp = mkdtempSync(join(tmpdir(), "aos-momentum-3100b-"))
  const repo = join(tmp, "repo")
  const prog = join(tmp, "prog")
  try {
    mkdirSync(repo, { recursive: true })
    g(repo, "init", "-q", "-b", "main", ".")
    g(repo, "config", "user.email", "t@t.local")
    g(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "a.ts"), "export const a = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "A")
    const a = g(repo, "rev-parse", "main")
    g(repo, "checkout", "-qb", "x")
    writeFileSync(join(repo, "x.ts"), "export const x = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "X")
    const x = g(repo, "rev-parse", "HEAD")
    g(repo, "checkout", "-q", "main")
    g(repo, "checkout", "-qb", "y")
    writeFileSync(join(repo, "y.ts"), "export const y = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "Y")
    const y = g(repo, "rev-parse", "HEAD")
    g(repo, "checkout", "-q", "main")
    g(repo, "checkout", "-qb", "feat")
    g(repo, "merge", "-q", "--no-edit", "-m", "M", "x", "y")
    const m = g(repo, "rev-parse", "HEAD")

    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    copyFileSync(MERGE, join(prog, "hooks", "merge.sh"))
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${repo}'`,
        `BASE_BRANCH='main'`,
        `BASE_SHA='${a}'`,
        `HEAD_BRANCH='feat'`,
        `HEAD_SHA='${m}'`,
        `TITLE='t'`,
        `AUTHOR=''`,
        `MERGE_CMD=''`,
        `PR_NUM=''`,
        `STAGED_DIR='${prog}'`,
        `JUDGED_SPAN_FROM='${x}'`,
        `JUDGED_SPANS='${a}:${x} ${a}:${y} ${x}:${m}'`,
        `STOP_HISTORY='[]'`,
        `STOP_CFG='{"rounds":2,"novelMax":1,"minRounds":2}'`,
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(prog, "data", "review", "verdict.json"),
      JSON.stringify({ verdict: "accept", repo, base: a, judgedFrom: x, head: m, blocked: [], advisory: [] }),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: prog, encoding: "utf8", timeout: 8_000 })
    assert.equal(
      r.status === null ? `killed(${r.signal})` : "exited",
      "exited",
      `INV-4: the chain check must TERMINATE — with two judged spans on divergent lines (${x.slice(0, 8)} and ${y.slice(0, 8)}) the fold oscillates between them forever, so the merge stage never returns, the chain's last stage never ends, and the PR never hears an outcome. The fold's advance test must require the frontier to be an ancestor of the span head, not merely that the span head is not an ancestor of the frontier.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
