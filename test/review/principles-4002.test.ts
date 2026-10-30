// principles-4002 — the fixer's exit must open after round 1.
//
// The change's ruling: "after round 1, the branch owner may overrule a
// reject — answering EVERY blocked finding with a one-line why — and merge
// the EXACT bytes the verdict judged" (bin/whitehartlane:ship; ship.ts:
// "never on round 1 — good faith comes first; the exit opens after it").
//
// The round counter is `verdictsForHead(headSha)` — the verdict files whose
// `head` EQUALS the sha being shipped. But a FIX is a commit: the fixer's
// fix moves the head, so the fix round's verdict names a DIFFERENT sha and
// the counter for the new head is back to 1. The exit therefore stays
// locked for the fixer who actually fixed ("round 1 of 1: … fix what you
// accept and re-review first" — a prescription that can never unlock it,
// because fixing is what moves the head), and opens only for a fixer who
// changed nothing and re-reviewed the same bytes.
//
// The repro: head A reviewed and rejected; the fixer fixes → head B
// reviewed and rejected again; the owner answers the finding and ships.
// That must work. Today the door refuses with "round 1 of 1".
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const writeVerdict = (home: string, sid: string, head: string, blocked: string[]) => {
  const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "verdict.json"),
    JSON.stringify({ verdict: "reject", head, blocked: blocked.map((id) => ({ id, severity: "P1", claim: "asserts the wrong requirement" })) }),
  )
}

test("whl ship: the exit opens after round 1 — a fixed head that was rejected again", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-rounds-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headA = git(repo, "rev-parse", "HEAD")
    // the FIXER'S FIX — a commit; the head moves, as it must
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 3\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "fix")
    const headB = git(repo, "rev-parse", "HEAD")
    assert.notEqual(headA, headB, "the fix moved the head")

    // round 1 judged head A (rejected); round 2 judged head B (rejected again)
    writeVerdict(home, "s-r1", headA, ["m-1"])
    writeVerdict(home, "s-r2", headB, ["m-1"])

    // a gh stub: the PR is at head B
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        `case "$1 $2" in "pr view") echo ${JSON.stringify(headB)} ;;`,
        `  *) printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))} ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement — the owner knows the intent" }))

    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(REPO_ROOT, "bin", "whitehartlane"),
        "ship",
        repo,
        "--pr",
        "42",
        "--overrule",
        overrule,
        "--head",
        "feat",
        "--base",
        "main",
        "--merge-cmd",
        `echo merged >> ${JSON.stringify(merged)}`,
      ],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          WHL_GATE_LEDGER: join(home, "gate.jsonl"),
          PATH: `${tmp}:${process.env.PATH}`,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    assert.equal(r.status, 0, `the exit must open after round 1 (stdout: ${r.stdout}\nstderr: ${r.stderr})`)
    assert.ok(existsSync(merged), "the merge must run")
    const calls = readFileSync(join(tmp, "gh-calls.txt"), "utf8")
    assert.match(calls, /pr comment 42/, "the overrule receipt reaches the PR")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
