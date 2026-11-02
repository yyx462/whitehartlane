// questions-3 (the questions lens, Q3/Q10) — the DELTA round must not
// shrink the FILE SET prove.sh classifies against.
//
// prove.sh's decision model (templates/pr-review/hooks/prove.sh:161-172)
// is a PAIR:
//
//   } else if (diffFiles.has(normFile(f.location?.file))) {
//     blocked.push({ ... outcome: "incomplete-fix" … })      // BLOCKS
//   } else {
//     advisory.push({ … "pre-existing, file a ticket, do not block" })
//   }
//
// where diffFiles is read from data/review/files-all.txt (line 41-49).
// The other half of the pair is the BASE checkout: the repro is copied
// into it and run there — against the TRUNK (intake.sh:59-60: "the BASE
// worktree below stays the TRUNK base … prove.sh's 'passes on BASE' law
// is unchanged").
//
// So the pair is: "fails on the TRUNK" AND "the diff touches the file".
// The diff's delta rounds change ONE half of that pair and leave the
// other alone:
//
//   intake.sh:64
//   git -C "$REPO" diff --name-only "$SPAN_FROM" "$HEAD_SHA" > files-all.txt
//
// files-all.txt is no longer base..head — it is the ROUND's delta. A
// file the PR touched in an EARLIER round (and did not fix) is no
// longer in the set, so its proven, still-broken finding is classified
// "pre-existing" — ADVISORY — and the merge proceeds over it.
//
// The file states the law itself, ten lines above the change
// (intake.sh:51-55):
//
//   "files-all.txt is the UNFILTERED list … prove's incomplete-fix
//    classification keys on the diff-file set … Machine truth stays
//    whole; only the reading shrank."
//
// The change shrank the MACHINE TRUTH (files-all.txt is the
// classification set, not the reading — files.txt / diff.patch are the
// reading).
//
// This repro drives the REAL intake.sh against a temp repo whose PR
// touches src/foo.ts in an earlier commit and src/bar.ts in the last
// one, and asserts that the classification set still names EVERY file
// the PR touched (base..head).
//
// BASE behaviour: BASE's intake.sh diffs base..head (no SPAN_FROM) →
// files-all.txt names both files → the assertion PASSES on BASE, and
// the diff DOES touch templates/pr-review/hooks/intake.sh → the prove
// gate classifies this as an introduced finding.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")

test("questions-3: the diff-file set prove.sh classifies against must stay the whole PR (base..head)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q3-filetru-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "foo.ts"), "export const foo = 1\n")
    writeFileSync(join(repo, "src", "bar.ts"), "export const bar = 1\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    const baseSha = g("rev-parse", "main").stdout.trim()
    g("checkout", "-qb", "feat")
    // an EARLIER round of the PR touches src/foo.ts …
    writeFileSync(join(repo, "src", "foo.ts"), "export const foo = 2\n")
    g("add", "-A")
    g("commit", "-qm", "one")
    const judged1 = g("rev-parse", "HEAD").stdout.trim()
    // … the LAST round touches only src/bar.ts
    writeFileSync(join(repo, "src", "bar.ts"), "export const bar = 2\n")
    g("add", "-A")
    g("commit", "-qm", "two")
    const headSha = g("rev-parse", "HEAD").stdout.trim()

    const dir = join(tmp, "prog")
    cpSync(join(ROOT, "templates", "pr-review"), dir, { recursive: true })
    mkdirSync(join(dir, "data", "review"), { recursive: true })
    writeFileSync(join(dir, "data", "review", "config.sh"), [
      `REPO='${repo}'`,
      `BASE_BRANCH='main'`,
      `BASE_SHA='${baseSha}'`,
      `HEAD_BRANCH='feat'`,
      `HEAD_SHA='${headSha}'`,
      // the delta round: it reads (and classifies) from the last judged head
      `JUDGED_SPAN_FROM='${judged1}'`,
      `JUDGED_SPANS='${baseSha}:${judged1} ${judged1}:${headSha}'`,
      `TITLE='t'`,
      `AUTHOR=''`,
      `MERGE_CMD=''`,
      `PR_NUM=''`,
      `STAGED_DIR='${dir}'`,
      "",
    ].join("\n"))
    // the door's handoff (intake refuses without it)
    writeFileSync(join(dir, "data", "review", "lenses.txt"), "questions\n")
    const r = spawnSync("bash", [join(dir, "hooks", "intake.sh")], { cwd: dir, encoding: "utf8", timeout: 120_000 })
    assert.equal(r.status, 0, `intake must succeed: ${r.stdout} ${r.stderr}`)
    const filesAll = readFileSync(join(dir, "data", "review", "files-all.txt"), "utf8").split("\n").filter(Boolean)
    assert.ok(
      filesAll.includes("src/foo.ts"),
      `files-all.txt is the machine truth prove.sh's incomplete-fix classification keys on — it must name every file the PR touched (base..head), not only this round's delta; got ${JSON.stringify(filesAll)}`,
    )
    // the READING may shrink (that is the ruling) — files.txt / diff.patch
    // are the lens's file list and stay the delta; files-all.txt is NOT
    // the reading, it is the classification set.
    const files = readFileSync(join(dir, "data", "review", "files.txt"), "utf8").split("\n").filter(Boolean)
    assert.ok(files.length > 0, `the reading must still name this round's files: ${JSON.stringify(files)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
