// momentum-920 — the overrule exit must count THIS PR's rounds, not the
// trunk's history.
//
// The law, stated in the file that implements it (src/doors/ship.ts, the
// header): "never on round 1 — good faith comes first; the exit opens
// after it".  The gate that enforces it is shipCheck's
// `rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)` against
// `minRounds = 2`.
//
// The CLI feeds `repoRounds` from verdictsForBranch
// (src/doors/ship.ts:2102-2119): the verdicts whose head sha is ON this
// branch's history.  `onBranch` excludes exactly ONE sha — the BASE
// commit itself:
//
//   if (opts.base && sha === opts.base) return false
//   git merge-base --is-ancestor sha headSha   → true
//
// Every OTHER ancestor of the head counts.  But the base's own ancestors
// are the trunk's history: the heads of the PRs that were merged into
// the trunk BEFORE this PR was cut.  Their verdicts are other PRs'
// rounds — they judged other diffs, against other bases — and they are
// not this PR's rounds.
//
// So on any repo whose trunk has a merged PR behind it (every repo past
// its first PR), `repoRounds >= 2` the moment this PR is opened, and the
// overrule exit is WIDE OPEN on this PR's FIRST reject: the fixer never
// gets a good-faith round.  The round-10 fix excluded the base commit
// itself; the real shape (a merged PR's head, an ancestor of the base)
// still slips through.
//
// The repro drives the REAL door (`whitehartlane ship`) with a repo
// whose trunk carries one earlier, already-merged PR's verdict, and
// asserts the exit stays shut and the merge does not run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

const writeVerdict = (home: string, sid: string, verdict: Record<string, unknown>): void => {
  const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdict))
}

test("ship: a brand-new PR's FIRST reject must not open the overrule exit (the trunk's earlier PRs are not this PR's rounds)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-rounds-ancestor-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    // PR A — merged into the trunk before this PR is cut
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "pr-a")
    const prASha = git(repo, "rev-parse", "HEAD")
    // the trunk tip — THIS PR's base
    writeFileSync(join(repo, "src", "b.ts"), "export const b = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "trunk")
    const baseSha = git(repo, "rev-parse", "HEAD")
    // THIS PR's head
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "c.ts"), "export const c = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")

    // PR A's review — its verdict sits at PR A's head, an ANCESTOR of
    // this PR's base (the trunk's own history)
    writeVerdict(home, "s-old", {
      verdict: "reject",
      head: prASha,
      blocked: [{ id: "old-1", severity: "P1", claim: "an earlier PR's finding" }],
    })
    // THIS PR's FIRST reject — the round the fixer's good faith must buy
    writeVerdict(home, "s-cur", {
      verdict: "reject",
      repo,
      base: baseSha,
      head: headSha,
      blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
    })

    // a gh stub that answers the boundary probe with the judged head
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${headSha} ;;`, "esac", "exit 0", ""].join("\n"),
    )
    chmodSync(gh, 0o755)
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
        "--base",
        "main",
        "--merge-cmd",
        `echo merged >> ${merged}`,
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
    assert.ok(
      !existsSync(merged),
      `the overrule exit must stay shut on round 1 of THIS PR — the merge must not run (stderr: ${r.stderr.trim()})`,
    )
    // BASE carries no overrule door at all — there the exit cannot be open
    const hasShipDoor = existsSync(join(import.meta.dirname, "..", "..", "src", "doors", "ship.ts"))
    if (hasShipDoor) assert.match(r.stderr, /good faith/, "the refusal must name the law it refuses on")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
