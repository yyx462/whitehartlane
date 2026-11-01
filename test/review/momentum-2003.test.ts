// momentum-2003 — the SHIP DOOR's base-drift guard SKIPS the check when
// the base cannot be read (its twin in merge.sh refuses).
//
// WHAT THE CHANGE CLAIMS (bin/whitehartlane, the `ship` verb — the door is
// added by THIS diff):
//
//   // THE BASE'S HALF (principles-45 / questions-34): this door is a
//   // SECOND merge site, and until now it kept only the HEAD half of
//   // merge.sh's drift guards — a base that moved during the review
//   // lands unreviewed commits inside the accepted override merge, the
//   // exact case merge.sh refuses (principles-108). ... A verdict that
//   // names NO base cannot be override-merged at all ... and FAIL-SAFE is
//   // the only direction (unverifiable is unmerged).
//
//   let trunkNow = ""
//   try {
//     trunkNow = execFileSync("git", ["-C", repoAbs, "rev-parse", `${baseRef}^{commit}`], ...).trim()
//   } catch {
//     trunkNow = ""
//   }
//   if (trunkNow && trunkNow !== verdictBase) {
//     console.error(`ship: base ${baseRef} moved ...`)
//     process.exitCode = 1
//     return
//   }
//
// The `trunkNow &&` guard makes "the base could not be read" SKIP the
// comparison — the one direction the comment forbids ("unverifiable is
// unmerged"). The TWIN in the SAME change (templates/pr-review/hooks/
// merge.sh, the base arm added by THIS diff) fails CLOSED on the very
// condition:
//
//   now_base="$(git -C "$REPO" rev-parse --verify "$BASE_BRANCH^{commit}" 2>/dev/null || true)"
//   if [ -z "$now_base" ]; then
//     echo "merge: base $BASE_BRANCH could not be read — its drift cannot be verified; refusing" >&2
//     exit 1
//   fi
//
// ONE DECISION, TWO SITES, TWO ANSWERS (INV-3).
//
// THE PATH: the trunk is RENAMED between the review and the override
// (main → trunk is a common corporate move), or the operator's clone no
// longer carries the trunk branch, or --base names a branch that does not
// exist. The base the verdict judged (verdict.base) cannot be compared with
// anything, the check is skipped, and the override merge — `gh pr merge <n>`
// — lands the PR on whatever the trunk is NOW: unreviewed commits inside an
// accepted merge.
//
// WHAT MUST HAPPEN: the door REFUSES (a message naming the base, exit
// non-zero) and never merges. A crash is not a refusal: the door must not
// die with an unhandled exception.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

const git = (cwd: string, ...a: string[]): string =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("momentum-2003: a base that CANNOT be read is not a witness — the override must REFUSE, never merge", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2003-"))
  const prevHome = process.env.AGENTIC_OS_HOME
  const home = join(tmp, "home")
  process.env.AGENTIC_OS_HOME = home
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    const baseSha = git(repo, "rev-parse", "main")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "feat")

    // two reject rounds for this head, naming the base they judged
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          verdict: "reject",
          repo,
          base: baseSha,
          head: headSha,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
    }

    // a gh stub: the boundary probe answers with the judged head
    const marker = join(tmp, "merged.txt")
    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `case "$1 $2" in`,
        `  "pr view") echo ${JSON.stringify(headSha)} ;;`,
        `  *) printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))} ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(join(bin, "gh"), 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        BIN,
        "ship",
        repo,
        "--pr",
        "42",
        "--overrule",
        overrule,
        "--head",
        "feat",
        // THE FAULT: the base the verdict judged cannot be named/read
        // any more (the trunk was renamed; the clone lost it)
        "--base",
        "renamed-trunk",
        "--merge-cmd",
        `touch ${marker}`,
      ],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          WHL_GATE_LEDGER: join(home, "gate.jsonl"),
          PATH: `${bin}:${process.env.PATH}`,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    assert.ok(
      !existsSync(marker),
      `INV-3 (one decision, one place — the base-drift decision is made in TWO sites by THIS ` +
        `change and they disagree): the override merge RAN on a base nobody could verify: ` +
        `trunkNow was "" (the base could not be read), so the guard's "trunkNow && ..." skipped ` +
        `the comparison — the door's own law says "unverifiable is unmerged", and merge.sh's twin ` +
        `refuses exactly this ("base ... could not be read — its drift cannot be verified; ` +
        `refusing"). (stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
    assert.notEqual(r.status, 0, `the door must REFUSE (stdout: ${r.stdout} stderr: ${r.stderr})`)
    assert.doesNotMatch(
      `${r.stdout}${r.stderr}`,
      /at .*\(.*:\d+:\d+\)|Error:|node:internal/,
      `a crash is not a refusal: the door must refuse with a message naming the base ` +
        `(stdout: ${r.stdout} stderr: ${r.stderr})`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
