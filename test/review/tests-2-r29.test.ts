// tests-2 — the overrule exit must not open on round 1.
//
// ship.ts's law (the file's own header, line 14): "never on round 1 — good
// faith comes first; the exit opens after it". The gate that enforces it is
// shipCheck: `rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)`.
//
// The CLI feeds it `repoRounds: verdictsForRepo(repoAbs).length` — EVERY
// verdict on this machine whose head sha exists in the repo (or whose `repo`
// field names it). That count is the repo's WHOLE review history, not this
// branch's rounds: two earlier reviews of two other PRs in the same repo
// open the exit for a brand-new PR's FIRST reject.
//
// The repro drives the real door (`whitehartlane ship`) with a repo that
// already carries two earlier verdicts for other heads. The exit must stay
// shut — the fixer's good faith comes first — and the merge must not run.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

const writeVerdict = (home: string, sid: string, verdict: Record<string, unknown>): void => {
  const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdict))
}

test("ship: the overrule exit must stay shut on round 1 of THIS head (the repo's earlier rounds are not this PR's rounds)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-rounds-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    const baseSha = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")

    // the repo's EARLIER review history — two verdicts for OTHER heads
    // (other PRs, earlier work). Their shas exist in this repo, so the
    // repo-round count sees them.
    writeVerdict(home, "s-old1", { verdict: "reject", head: baseSha, blocked: [{ id: "old-1", severity: "P1", claim: "old" }] })
    writeVerdict(home, "s-old2", { verdict: "accept", head: baseSha, blocked: [] })

    // THIS head's first round: one reject, one blocked finding
    writeVerdict(home, "s-cur", {
      verdict: "reject",
      repo,
      base: baseSha,
      head: headSha,
      blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
    })

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    // a gh stub: the PR's remote head IS the judged head (no drift here)
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"),
    )
    chmodSync(gh, 0o755)

    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      PATH: `${tmp}:${process.env.PATH}`,
    }
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
        `echo merged >> ${JSON.stringify(merged)}`,
      ],
      { env, encoding: "utf8", timeout: 60_000 },
    )
    assert.notEqual(
      r.status,
      0,
      `the overrule exit must stay shut on round 1 of this head (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
    assert.ok(
      !existsSync(merged),
      `no merge may ride an exit that opened before good faith (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
    assert.match(
      `${r.stdout}${r.stderr}`,
      /good faith|round 1/i,
      `the refusal must name the good-faith law (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
