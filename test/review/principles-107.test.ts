// principles-107 — "was the override recorded?" must be answered by what
// HAPPENED, not by what was ATTEMPTED.
//
// The change adds a ledger row to the gate's ledger when the owner
// overrules a reject (bin/whitehartlane:764-776, action: "override").
// The gate's ledger is the gate's memory of what it decided — it is read
// back by classStats (src/doors/review-gate.ts:195-228), which counts
// rows by their action, and by the review trace.
//
// The row is appended BEFORE the merge is attempted and BEFORE the
// stale-bytes check (bin/whitehartlane:791-803). So the ledger records
// action:"override" for a run where the override NEVER HAPPENED:
//
//   * the PR's head moved → the door refuses ("bytes no verdict judged
//     would ride the override") → exit 1, NOTHING merged, but the ledger
//     says "override";
//   * the merge command failed → "the overrule is ledgered, the PR is NOT
//     merged" (the door's own message!) → the ledger says "override" for a
//     PR that was not merged.
//
// The second case is the door telling the truth IN ITS OWN ERROR MESSAGE
// while the ledger it just wrote says the opposite. The ledger is the
// gate's record of what happened; a row that claims an override for a PR
// that was never overridden is a false fact in the one store that
// downstream readers (classStats, the trace, the next reviewer) consult.
//
// The repro: a PR whose remote head is NOT the judged sha (the
// stale-bytes refusal). The merge must not run, and the gate's ledger
// must not carry an "override" row.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("principles-107: a refused override must not be ledgered as an override (the ledger records what happened)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-107-"))
  try {
    const home = join(tmp, "home")
    const repo = join(tmp, "repo")
    const merged = join(tmp, "merged.txt")
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
    const headSha = git(repo, "rev-parse", "HEAD")

    // two rounds on this head, so the overrule exit is open
    for (const sid of ["s-r1", "s-r2"]) {
      const d = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, "verdict.json"),
        JSON.stringify({ verdict: "reject", head: headSha, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }),
      )
    }

    // the gh stub: the PR's head MOVED — the stale-bytes refusal
    const gh = join(tmp, "gh")
    writeFileSync(gh, ["#!/bin/sh", `case "$1 $2" in "pr view") echo deadbeefdeadbeefdeadbeefdeadbeefdeadbeef ;; esac`, "exit 0", ""].join("\n"))
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the owner knows the intent" }))
    const ledger = join(home, "gate.jsonl")

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
        env: { ...process.env, AGENTIC_OS_HOME: home, WHL_GATE_LEDGER: ledger, PATH: `${tmp}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
        timeout: 60_000,
      },
    )
    assert.notEqual(r.status, 0, "the stale-bytes refusal must exit non-zero")
    let rows: { action: string }[] = []
    try {
      rows = readFileSync(ledger, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { action: string })
    } catch {
      rows = []
    }
    const overrides = rows.filter((x) => x.action === "override")
    assert.equal(
      overrides.length,
      0,
      `the gate's ledger must not record an "override" for a PR that was never overridden — ` +
        `the door refused ("bytes no verdict judged would ride the override") and the merge never ran, ` +
        `but the ledger carries ${overrides.length} override row(s). The ledger is the gate's record of what ` +
        `happened; classStats and the review trace read it back. The row is appended before the stale-bytes ` +
        `check and before the merge (bin/whitehartlane:764-776).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
