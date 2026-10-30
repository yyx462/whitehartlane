// questions-1 (questions lens, Q1/Q6) — THE OVERRULE EXIT OPENS ON ROUND 1
// on any repo that has verdict history.
//
// What the change claims (src/doors/ship.ts:39-45 and 97-103):
//   "the overrule exit counts the owner's ROUNDS, not the rounds of one
//    sha — a fixer who changed bytes (a new head) and was rejected again
//    is on round 2, not on 'round 1 of 1'; counting per sha locked the
//    exit against exactly the fixer it was built for."
//   "never on round 1    good faith comes first; the exit opens after it"
//   (src/doors/ship.ts:14 — the door's own law list)
//
// What the change DOES (src/doors/ship.ts:100):
//   const rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)
// and the bin hands it the repo's WHOLE verdict history (bin/whitehartlane:
// `repoRounds: verdictsForRepo(repoAbs).length`):
//   verdictsForRepo counts EVERY verdict whose head sha exists in the repo
//   (src/doors/ship.ts:47-58) — verdicts of other PRs, other branches,
//   other weeks, accept or reject. It is the repo's LIFETIME count, not
//   this commission's round count.
//
// So on an established repo the FIRST reject of a NEW head already
// satisfies "rounds >= 2": the owner merges under override WITHOUT fixing
// anything, and the good-faith round the law demands never happens. The
// door's own receipt then prints "(round 1)" — the number shipCheck
// itself refused to count (ship.ts:118 returns `opts.rounds.length`).
//
// The repro: a real repo, a real verdict store (two OLD verdicts at an
// older sha + the ONE reject under review), a gh stub and the door's own
// CLI. Round 1 must refuse — and the merge must not happen.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("questions-1: the overrule exit must stay shut on round 1 (good faith first)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q1-rounds-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (...a: string[]) => execSync(`git ${a.join(" ")}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse HEAD").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")
    const headSha = g("rev-parse HEAD").trim()

    // the verdict store: the repo's HISTORY (two verdicts at the older
    // sha — their shas exist in this repo, so verdictsForRepo counts
    // them) + the ONE reject under review (this head's round 1).
    const writeVerdict = (sid: string, head: string, verdict: string, blocked: unknown[]) => {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "verdict.json"), JSON.stringify({ verdict, head, blocked }))
    }
    writeVerdict("s-old-1", baseSha, "accept", [])
    writeVerdict("s-old-2", baseSha, "reject", [{ id: "old-1", severity: "P1", claim: "an older round's finding" }])
    writeVerdict("s-now", headSha, "reject", [{ id: "m-1", severity: "P1", claim: "the repro asserts the wrong requirement" }])

    // the gh stub: `pr view` answers the judged head, `pr comment` is a no-op
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"),
    )
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement — the owner knows the intent" }))
    const merged = join(tmp, "merge-happened.txt")
    const mergeCmd = `echo merged >> ${JSON.stringify(merged)}`

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
        mergeCmd,
      ],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          WHL_GATE_LEDGER: join(home, "gate.jsonl"),
          PATH: `${tmp}:${process.env.PATH ?? ""}`,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    assert.ok(
      !existsSync(merged),
      `the override merged on ROUND 1 of this head — the good-faith round never happened (the repo's older verdicts were counted as rounds).\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
    assert.match(
      r.stderr,
      /good faith/i,
      `the door must refuse on round 1 and say why (the law: never on round 1 — good faith comes first).\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
