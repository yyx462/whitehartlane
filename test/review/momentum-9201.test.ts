// momentum-9201 — the overrule exit's ROUND count.
//
// ship.ts's law (its own header): "never on round 1 — good faith comes
// first; the exit opens after it". The exit opens when the owner has
// had a round in which the FIXER could fix something.
//
// The implementation counts VERDICTS, not rejection rounds:
//
//   const rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)
//
// opts.rounds = verdictsForHead(headSha)   — every verdict for this
//                  head, newest first
// opts.repoRounds = verdictsForBranch(...) — every verdict whose head is
//                  on this branch's span (ACCEPT verdicts included)
//
// So TWO verdicts for the SAME head — what a re-levy at UNCHANGED bytes
// leaves behind (the chain died after prove.sh wrote the verdict; the
// owner re-ran the review; NOTHING was fixed) — count as TWO rounds and
// open the exit. The good-faith round never happened.
//
// The repro drives the real door (`whl ship`) so it loads on BASE too
// (BASE has no ship verb — the door refuses, which is the honest
// round-1 answer the assertion demands).
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("the overrule exit stays shut on round 1 — a re-levy at the same head is not good faith", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-momentum-9201-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const shim = join(tmp, "shim")
  mkdirSync(shim, { recursive: true })
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")
    const headSha = g("rev-parse HEAD").trim()

    // TWO reject verdicts for the SAME head — the re-levy at unchanged
    // bytes. No fix landed between them: the diff is identical.
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
          blocked: [{ id: "m-1", severity: "P1", claim: "a proven finding" }],
        }),
      )
    }

    // a gh stub: the remote head answers with the judged sha
    const gh = join(shim, "gh")
    writeFileSync(
      gh,
      ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;; esac`, "exit 0", ""].join("\n"),
    )
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))
    const merged = join(tmp, "merged.txt")
    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      PATH: `${shim}:${process.env.PATH}`,
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
      `the overrule exit must stay shut until a real round of good faith (a rejection of FIXED bytes); ` +
        `the door merged a first-round rejection after a re-levy at the same head — stdout: ${r.stdout} stderr: ${r.stderr}`,
    )
    assert.ok(!existsSync(merged), "nothing merged on round 1")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
