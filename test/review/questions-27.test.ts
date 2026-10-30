// questions-27 (questions lens, Q2/Q6) — THE OVERRULE EXIT OPENS ON ROUND 1
// of a brand-new PR: the TRUNK's history counts as this PR's rounds.
//
// The new door's own law list (src/doors/ship.ts:1-17):
//   "never on round 1    good faith comes first; the exit opens after it"
// and shipCheck enforces it with a round count:
//   const rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)
//   if (rounds < minRounds) return { ok: false, … "round 1 of N: the
//     overrule opens after good faith …" }
//
// The CLI feeds it (bin/whitehartlane, the `ship` verb):
//   repoRounds: verdictsForBranch(repoAbs, headSha, { base: baseSha }).length
//
// verdictsForBranch (src/doors/ship.ts, NEW in this diff) counts every
// verdict whose head sha is ON this branch's history:
//   const onBranch = (sha) => {
//     if (sha === headSha) return true
//     if (opts.base && sha === opts.base) return false   ← only the base sha
//     return git merge-base --is-ancestor sha headSha      ← EVERY ancestor
//   }
//
// The base sha is excluded, but the base's ANCESTORS are not: the trunk's
// history — the heads of previously MERGED PRs. A repo with two earlier
// rejected-and-merged PRs therefore hands a BRAND-NEW PR two "rounds" it
// never lived, and the exit opens on the new PR's FIRST reject: the
// fixer never gets a chance to fix the findings and have them re-reviewed.
//
// The repro drives the REAL door (`whitehartlane ship`) against a repo
// whose trunk carries two earlier rejects and whose brand-new PR has a
// single reject. The exit must stay shut and no merge may ride it.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

test("questions-27: the overrule exit stays shut on round 1 of THIS PR (the trunk's history is not this PR's rounds)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "q1-rounds-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")

    // the TRUNK's history: two earlier PRs, each reviewed and rejected,
    // each merged into main. Their heads are ANCESTORS of this PR's base.
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "trunk-1")
    const oldHead1 = git(repo, "rev-parse", "HEAD")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "trunk-2")
    const baseSha = git(repo, "rev-parse", "HEAD")

    // THIS PR: a brand-new branch off the trunk, one review, one reject
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const headSha = git(repo, "rev-parse", "HEAD")

    // the trunk's earlier verdicts — other PRs' rejects, on commits that
    // are ancestors of this PR's base (the shape verdictsForBranch keeps)
    writeVerdict(home, "s-old1", { verdict: "reject", head: oldHead1, blocked: [{ id: "old-1", severity: "P1", claim: "old" }] })
    writeVerdict(home, "s-old2", { verdict: "reject", head: baseSha, blocked: [{ id: "old-2", severity: "P1", claim: "old" }] })

    // THIS head's FIRST round: one reject, one blocked finding
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
      `the overrule exit must stay shut on round 1 of THIS PR — the trunk's earlier rejects are OTHER PRs' rounds (stdout: ${r.stdout}\nstderr: ${r.stderr})`,
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
