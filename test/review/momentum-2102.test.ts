// momentum-2102 — the override receipt must report the HONEST round.
//
// src/doors/ship.ts states the law it is fixing:
//
//   "the ROUNDS are HEADS, not rows (momentum-9201 / questions-3 /
//    tests-10502): two verdicts for the SAME head — a re-levy at
//    unchanged bytes — are ONE rejection round, not two; counting
//    verdict rows opened the override on the first reject and the
//    receipt reported a fabricated 'round 2'. Distinct judged heads
//    (with the repo's own rounds, principles-4002: a fixer who changed
//    bytes and was rejected again is on round 2) — the exit opens for
//    exactly that fixer."
//
//   const judgedHeads = new Set(opts.rounds.map((r) => r.verdict.head))
//   const rounds = Math.max(judgedHeads.size, opts.repoRounds ?? 0)
//   if (rounds < minRounds) { …refuse… }
//   …
//   return { ok: true, verdict: latest, rounds: judgedHeads.size, overrules }
//
// The GATE uses `rounds` (the max — the honest count). The RECEIPT returns
// `judgedHeads.size`.
//
// And what the door feeds `opts.rounds` is `verdictsForHead(headSha)` — EVERY
// verdict whose head IS this sha. So every entry carries the SAME head:
// `judgedHeads.size` is ALWAYS 1 on the success path.
//
// The receipt therefore always says "(round 1)" — on a PR that was rejected
// 17 times — while the gate that opened the exit used the honest count. The
// record contradicts itself: the door's own law says "never on round 1", and
// the receipt says the override merged on round 1.
//
// test/ship.test.ts's "shipCheck: the four laws" cannot see this: its `two`
// fixture carries TWO DIFFERENT HEADS, a shape the door never produces.
//
// The repro drives the REAL door end-to-end (two reject rounds on two heads,
// a gh stub, a real merge command) and asserts the receipt names the round
// the gate actually used.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("whl ship: the override receipt names the honest round, not a hardcoded 1", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2102-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
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
  const judged1 = g("rev-parse HEAD").trim()
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false // fix\n")
  g("add -A && git commit -qm fix")
  const headSha = g("rev-parse HEAD").trim()
  // two reject rounds on TWO heads (the honest round 2)
  for (const [sid, head, ago] of [["s-r1", judged1, 60], ["s-r2", headSha, 0]] as const) {
    const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
    mkdirSync(dir, { recursive: true })
    const vf = join(dir, "verdict.json")
    writeFileSync(vf, JSON.stringify({ verdict: "reject", repo, base: baseSha, head, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }))
    const t = Date.now() / 1000 - ago
    utimesSync(vf, t, t)
  }
  const gh = join(tmp, "gh")
  writeFileSync(
    gh,
    ["#!/bin/sh", `case "$1 $2" in "pr view") echo ${JSON.stringify(headSha)} ;;`, `  *) printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))} ;;`, "esac", "exit 0", ""].join("\n"),
  )
  chmodSync(gh, 0o755)
  const overrule = join(tmp, "o.json")
  writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement — the reviewer sees the diff, the owner knows the intent" }))
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    PATH: `${tmp}:${process.env.PATH}`,
  }
  const mergeCmd = `echo merged >> ${JSON.stringify(join(tmp, "merge-happened.txt"))}`
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(import.meta.dirname, "..", "..", "bin", "whitehartlane"), "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", "main", "--merge-cmd", mergeCmd],
    { env, encoding: "utf8", timeout: 60_000 },
  )
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.ok(existsSync(join(tmp, "merge-happened.txt")), "the merge ran — the exit opened, so a round was counted")
  assert.match(
    r.stdout,
    /round 2/,
    `the receipt must name the round the gate counted (two judged heads on this branch = round 2); the receipt said: ${r.stdout.trim()}`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
