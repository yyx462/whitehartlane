// ship — the fixer's right to reject a rejection (the 2026-10-30
// ruling): after round 1, the owner may overrule a reject, answering
// every blocked finding with a one-line why, merging the EXACT bytes
// the verdict judged. Pinned here: the four laws — never in the dark,
// never stale bytes, never round 1, never stealth.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { overruleComment, shipCheck, verdictsForHead, type Verdict } from "../src/doors/ship.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-ship-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const HEAD = "a".repeat(40)
const v = (blocked: string[], verdict = "reject"): Verdict => ({
  verdict,
  head: HEAD,
  blocked: blocked.map((id, i) => ({ id, severity: "P1", claim: `claim ${i}` })),
})

const writeVerdict = (home: string, sid: string, blocked: string[], verdict = "reject") => {
  const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(v(blocked, verdict)))
}

test("verdictsForHead: newest first by mtime, this head only", () => {
  const home = process.env.AGENTIC_OS_HOME!
  writeVerdict(home, "s-old", ["x-1"])
  writeVerdict(home, "s-new", ["y-1"])
  const hits = verdictsForHead(HEAD, join(home, "sessions"))
  assert.equal(hits.length, 2)
  assert.equal(hits[0].verdict.blocked[0].id, "y-1", "mtime-newest wins")
  assert.equal(verdictsForHead("b".repeat(40), join(home, "sessions")).length, 0)
})

test("shipCheck: the four laws", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-check-"))
  const f = join(tmp, "o.json")
  const rounds = (n: number) => Array.from({ length: n }, (_, i) => ({ verdict: v([`f-${i}`]), at: i }))
  // never round 1 — good faith first
  writeFileSync(f, JSON.stringify({ "f-0": "why" }))
  assert.match((r => r.ok ? "" : r.why)(shipCheck({ headSha: HEAD, overruleFile: f, rounds: rounds(1) })), /good faith/)
  // never in the dark: an unanswered finding refuses
  const two = [{ verdict: v(["f-a", "f-b"]), at: 2 }, { verdict: v(["f-a"]), at: 1 }]
  writeFileSync(f, JSON.stringify({ "f-a": "why" })) // f-b left unanswered
  assert.match((r => r.ok ? "" : r.why)(shipCheck({ headSha: HEAD, overruleFile: f, rounds: two })), /unanswered blocked finding/)
  // an invented id refuses (feedback never invents, and neither does an overrule)
  writeFileSync(f, JSON.stringify({ "f-a": "why", "f-b": "why", "f-ghost": "why" }))
  assert.match((r => r.ok ? "" : r.why)(shipCheck({ headSha: HEAD, overruleFile: f, rounds: two })), /not a blocked finding/)
  // all answered → ok, with the whys
  writeFileSync(f, JSON.stringify({ "f-a": "the repro asserts the wrong requirement", "f-b": "working as intended" }))
  const ok = shipCheck({ headSha: HEAD, overruleFile: f, rounds: two })
  assert.ok(ok.ok)
  assert.equal(ok.rounds, 2)
  // an accept has nothing to overrule
  const accept = [{ verdict: v([], "accept"), at: 2 }, { verdict: v(["f-a"]), at: 1 }]
  assert.match((r => r.ok ? "" : r.why)(shipCheck({ headSha: HEAD, overruleFile: f, rounds: accept })), /not reject/)
  rmSync(tmp, { recursive: true, force: true })
})

test("overruleComment: every overruled fact and its why, named", () => {
  const c = overruleComment({ pr: "42", verdict: v(["f-1"]), overrules: { "f-1": "asserts the wrong requirement" }, by: "opencode:ses_x" })
  assert.match(c, /MERGED UNDER OVERRIDE/)
  assert.match(c, /f-1/)
  assert.match(c, /asserts the wrong requirement/)
  assert.match(c, /opencode:ses_x/)
  assert.match(c, /override, not a refutation/)
})

// the CLI drive: a real repo, real verdict files, a stubbed gh — the
// whole law in one receipt (merge cmd + comment + ledger row)
test("whl ship: the end-to-end override — merge, receipt, ledger", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-cli-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm feat")
  const headSha = g("rev-parse HEAD").trim()
  // two reject rounds on this head
  for (const sid of ["s-r1", "s-r2"]) {
    const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "verdict.json"), JSON.stringify({ verdict: "reject", head: headSha, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }))
  }
  // a gh stub: records the comment body, exit 0
  const gh = join(tmp, "gh")
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))}\n`)
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
    ["--experimental-strip-types", join(import.meta.dirname, "..", "bin", "whitehartlane"), "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", "main", "--merge-cmd", mergeCmd],
    { env, encoding: "utf8", timeout: 60_000 },
  )
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`)
  assert.match(r.stdout, /merged under override/)
  assert.ok(existsSync(join(tmp, "merge-happened.txt")), "the merge ran")
  const calls = readFileSync(join(tmp, "gh-calls.txt"), "utf8")
  assert.match(calls, /pr comment 42/, "the receipt reached the PR (via the gh stub)")
  const rows = readFileSync(join(home, "gate.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  assert.equal(rows[rows.length - 1].action, "override", "the override is ledgered")
  rmSync(tmp, { recursive: true, force: true })
})
