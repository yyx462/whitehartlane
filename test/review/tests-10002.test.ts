import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard: the corpus exclusion in intake.sh is this diff's
// own change. On BASE intake writes the FULL file list, so the law
// below holds there; on HEAD the exclusion quietly edits the list the
// prove gate classifies against.
const INTAKE = readFileSync(join(ROOT, "templates", "pr-review", "hooks", "intake.sh"), "utf8")
const EXCLUDES_CORPUS = INTAKE.includes(":(exclude)test/review")

// Meta-ACH: reverted-half / twin. The diff excludes `test/review` from
// the lens-visible diff AND from `files.txt` (intake.sh, 2026-10-30:
// "the lens diff excludes the repro corpus"). But files.txt is not
// just a reading list — it is the prove gate's DIFF-IMPLICATION
// ORACLE (prove.sh: `diffFiles.has(normFile(f.location?.file))` is
// what separates an incomplete-fix BLOCK from a pre-existing
// advisory). A finding whose location is an adopted corpus test — the
// exact class this corpus generated (r2: "a suite test asserting the
// wrong thing") — whose repro fails on HEAD twice and on BASE is a
// PROVEN fact (INV-8); the exclusion reclassifies it advisory
// forever, structurally: no test/review file can ever be "in the
// diff" again. The reading was optimized; the classifier's twin was
// forgotten. This repro materializes a minimal program (the real
// prove.sh), files a P1 finding against an adopted test/review file
// whose repro fails with an AssertionError on BOTH sides, feeds
// files.txt as intake writes it (corpus excluded on HEAD, full on
// BASE), and asserts the fact still BLOCKS as incomplete-fix.
test("a proven repro on a test/review file still classifies incomplete-fix — the corpus exclusion must not demote proven facts (INV-8)", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-t10002-prog-"))
  try {
    mkdirSync(join(prog, "hooks"), { recursive: true })
    cpSync(join(ROOT, "templates", "pr-review", "hooks", "prove.sh"), join(prog, "hooks", "prove.sh"))
    mkdirSync(join(prog, "data", "review", "head", "test", "review"), { recursive: true })
    mkdirSync(join(prog, "data", "review", "base"), { recursive: true })

    // the adopted corpus test: the same bytes ride BASE..HEAD (an
    // adoption/fix commit touched it), and its assertion is wrong on
    // BOTH sides — the incomplete-fix precondition
    const repro = [
      'import assert from "node:assert/strict"',
      'import test from "node:test"',
      'test("the adopted assertion pins the wrong expected value", () => {',
      "  assert.equal(1 + 1, 3, \"the adopted suite test asserts the wrong thing (the r2 class)\")",
      "})",
      "",
    ].join("\n")
    writeFileSync(join(prog, "data", "review", "head", "test", "review", "adopted.test.ts"), repro)

    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        "REPO='/tmp/whl-t10002-repo'",
        "BASE_BRANCH='main'",
        "BASE_SHA='0000000000000000000000000000000000000000'",
        "HEAD_BRANCH='feat'",
        "HEAD_SHA='1111111111111111111111111111111111111111'",
        "TITLE='fixture'",
        "AUTHOR=''",
        "MERGE_CMD=''",
        "",
      ].join("\n"),
    )

    // files.txt as intake materializes it: BASE writes the full list
    // (the diff DOES touch the corpus file); HEAD's exclusion drops it.
    // ADAPTED AT ADOPTION (gate-r34): the fix has intake write
    // files-all.txt — the UNFILTERED machine truth prove's classifier
    // reads — beside the filtered lens list. The fixture mirrors the
    // fixed intake.
    const files = EXCLUDES_CORPUS ? "src/wait.ts\n" : "src/wait.ts\ntest/review/adopted.test.ts\n"
    writeFileSync(join(prog, "data", "review", "files.txt"), files)
    writeFileSync(join(prog, "data", "review", "files-all.txt"), "src/wait.ts\ntest/review/adopted.test.ts\n")

    // the finding: P1, its location is the adopted corpus test, its
    // repro is that same failing test
    const finding = {
      id: "tests-10002",
      lens: "tests",
      severity: "P1",
      claim: "the adopted suite test asserts the wrong expected value",
      location: { file: "test/review/adopted.test.ts", line_start: 4 },
      invariant: "INV-8",
      scenario: "the corpus test fails on HEAD, twice, and on BASE — a proven fact about a file the diff touches",
      repro: { test_path: "test/review/adopted.test.ts", command: "node --test test/review/adopted.test.ts", expected_failure: "the adopted assertion is wrong" },
    }
    mkdirSync(join(prog, "units", "tests"), { recursive: true })
    writeFileSync(join(prog, "units", "tests", "findings.jsonl"), JSON.stringify(finding) + "\n")

    const ran = spawnSync("bash", [join(prog, "hooks", "prove.sh")], { encoding: "utf8", timeout: 120_000 })
    assert.equal(ran.status, 0, `prove gate crashed: ${ran.stderr}`)

    const verdict = JSON.parse(readFileSync(join(prog, "data", "review", "verdict.json"), "utf8")) as {
      verdict: string
      blocked: { id: string; outcome: string }[]
      advisory: { id: string; why: string }[]
    }
    const mine = verdict.blocked.find((b) => b.id === "tests-10002")
    assert.ok(
      mine && mine.outcome === "incomplete-fix",
      `a proven fact (fails HEAD ×2 on an assertion, fails BASE, the diff touches ` +
        `test/review/adopted.test.ts) was classified ` +
        `${mine ? mine.outcome : `advisory (${verdict.advisory.find((a) => a.id === "tests-10002")?.why ?? "?"})`} — the corpus ` +
        `exclusion edits files.txt behind the prove gate's back, so an adopted test/review file can ` +
        `never again satisfy the diff-implication half of INV-8's law: the incomplete-fix class is ` +
        `structurally dead for exactly the files this review corpus owns`,
    )
    assert.equal(verdict.verdict, "reject", "a proven fact blocks the merge (INV-8)")
  } finally {
    rmSync(prog, { recursive: true, force: true })
  }
})
