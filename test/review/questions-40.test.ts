// questions-40 (questions lens, Q5/Q10) — the gate's ledger records an
// OVERRIDE for a PR that was NEVER merged.
//
// The change adds the fixer's exit (`whl ship`, bin/whitehartlane) and
// states its own law for the ledger row (bin/whitehartlane:864-868):
//
//   // the ledger row lands HERE, after every refusal (principles-107):
//   // a row written before the stale-bytes check recorded an override
//   // for a PR that was never overridden — the ledger is a record of
//   // what HAPPENED, not what was attempted
//
// It fixed the REFUSAL paths (the row is written after the verdict /
// base / stale-bytes refusals — principles-107's repro). The MERGE
// FAILURE path was left on the other side of the row:
//
//   bin/whitehartlane:869  appendLedgerRow({ …, action: "override", … })
//   bin/whitehartlane:886  const mergeCmd = …
//   bin/whitehartlane:887  execFileSync("sh", ["-c", mergeCmd], …)
//   bin/whitehartlane:890  catch → "ship: the merge command failed (…)
//                          — the overrule is ledgered, the PR is NOT merged"
//
// So a merge command that FAILS (expired auth, a conflict, a dead
// network) leaves an action:"override" row in the gate's ledger for a PR
// that was never overridden — the door's own error message says the
// opposite of the door's own law. The ledger is the gate's memory
// (classStats reads it back, src/doors/review-gate.ts:198-230; the
// review trace reads it; the next reviewer reads it).
//
// The repro drives the real bin: a repo with two reject rounds on two
// heads (so the overrule exit is open), a gh stub that answers the
// boundary probe with the judged head, and a merge command that FAILS.
// The merge must not happen and the ledger must not claim it did.
//
// (File named questions-40: questions-1..39.test.ts belong to prior
// review rounds and stay untouched.)
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("questions-40: a FAILED merge must not be ledgered as an override (the ledger records what happened)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q40-"))
  try {
    const home = join(tmp, "home")
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    const baseSha = git(repo, "rev-parse", "main")
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "round 1")
    const head1 = git(repo, "rev-parse", "HEAD")
    // the fix after round 1 — the honest round 2 is a rejection of
    // DIFFERENT bytes (two verdicts at ONE head are one round)
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 3\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "round 2")
    const head2 = git(repo, "rev-parse", "HEAD")

    // two reject rounds, on two heads, each naming the base it judged
    for (const [sid, head] of [["s-r1", head1], ["s-r2", head2]] as const) {
      const d = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, "verdict.json"),
        JSON.stringify({
          verdict: "reject",
          repo,
          base: baseSha,
          head,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
    }

    // the gh stub: the boundary probe answers with the judged head
    const gh = join(tmp, "gh")
    writeFileSync(gh, ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${head2} ;; esac`, "exit 0", ""].join("\n"))
    chmodSync(gh, 0o755)

    // a no-op orchestrator stub — a scratch drive never books a workflow
    const stub = join(tmp, "orch-stub.mjs")
    writeFileSync(stub, "process.exit(0)\n")

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))
    const ledger = join(tmp, "gate.jsonl")

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
        // the merge FAILS — the shape of an expired gh auth
        "--merge-cmd",
        "exit 3",
      ],
      {
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          AGENTIC_OS_ORCHESTRATOR: stub,
          WHL_GATE_LEDGER: ledger,
          PATH: `${tmp}:${process.env.PATH ?? ""}`,
        },
        encoding: "utf8",
        timeout: 60_000,
      },
    )

    assert.notEqual(r.status, 0, `the failed merge must exit non-zero (stdout: ${r.stdout}\nstderr: ${r.stderr})`)

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
      `INV-4: the merge command FAILED — nothing was merged, so the gate's ledger must not carry an ` +
        `"override" row. It carries ${overrides.length}: the row is appended at bin/whitehartlane:869, ` +
        `BEFORE the merge runs at bin/whitehartlane:887, and the door's own message says "the overrule is ` +
        `ledgered, the PR is NOT merged". The ledger is a record of what HAPPENED, not what was attempted ` +
        `(the law the change states at bin/whitehartlane:864-868).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
