// reviewctl — the lever's own tests: every verb driven the way a
// composing agent would (a fixture repo, the real door functions, the
// real hooks), --json shape pinned, guards pinned.
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import assert from "node:assert/strict"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-reviewctl-"))

const ROOT = join(import.meta.dirname, "..")
const BIN = join(ROOT, "bin", "whitehartlane")

const run = (args: string[]): string => {
  // spawnSync, not execFileSync: verdict exits 1 on a reject BY LAW
  // (honest exit codes compose) — that is a result, not a failure.
  const r = spawnSync("node", ["--experimental-strip-types", BIN, "reviewctl", ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  })
  if (r.status !== 0) {
    throw new Error(`reviewctl ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`)
  }
  return r.stdout
}

// the honest-exit twin: returns { code, stdout } without throwing.
const runCode = (args: string[]): { code: number; stdout: string } => {
  const r = spawnSync("node", ["--experimental-strip-types", BIN, "reviewctl", ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  })
  return { code: r.status ?? 1, stdout: r.stdout }
}

function fixtureRepo(where: string): string {
  const g = (...a: string[]) => execFileSync("git", ["-C", where, ...a], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "t@t")
  g("config", "user.name", "t")
  writeFileSync(join(where, "README.md"), "base\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

test("reviewctl --help prints the manual and exits 0", () => {
  const out = run(["--help"])
  assert.match(out, /reviewctl <verb>/)
  assert.match(out, /doctor/)
  assert.match(out, /--dry-run/)
})

test("unknown verb names the legal ones", () => {
  assert.throws(() => run(["bogus"]), (e: Error & { status?: number }) => {
    assert.match(e.message, /legal verbs: doctor, stage, hook/)
    return true
  })
})

test("stage materializes a program without booking a job; doctor agrees; lenses agree", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-reviewctl-stage-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const dir = join(tmp, "prog")
  const out = run(["stage", repo, "--base", "master", "--head", "feat", "--out", dir])
  assert.match(out, new RegExp(`staged: ${dir}`))
  assert.match(out, /lenses: (principles|tests|momentum)/)
  assert.ok(existsSync(join(dir, "workflow.toml")))

  const doc = run(["doctor", dir, "--json"])
  const d = JSON.parse(doc.slice(doc.indexOf("{")))
  assert.equal(d.ok, true, `doctor problems: ${JSON.stringify(d.problems)}`)
  assert.ok(d.stages.includes("intake") && d.stages.includes("prove") && d.stages.includes("merge"))

  const lenses = run(["lenses", dir])
  assert.doesNotMatch(lenses, /DISAGREEMENT/, "the handoff equals the workflow's own units")
  rmSync(tmp, { recursive: true, force: true })
})

test("hook runs a real staged hook and propagates its exit code", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-reviewctl-hook-"))
  const dir = join(tmp, "prog")
  mkdirSync(join(dir, "hooks"), { recursive: true })
  mkdirSync(join(dir, "data", "review"), { recursive: true })
  cpSync(join(ROOT, "templates", "pr-review", "hooks", "divide.sh"), join(dir, "hooks", "divide.sh"))
  writeFileSync(join(dir, "workflow.toml"), '[[stage]]\nid = "divide"\ntopology = "gate"\nrun = "bash hooks/divide.sh"\n')
  // accept verdict → divide exits 0 with no feedback
  writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [], advisory: [], adopt: [] }))
  const out = run(["hook", "divide.sh", "--dir", dir])
  assert.match(out, /accept — no feedback/)
  rmSync(tmp, { recursive: true, force: true })
})

test("hook refuses path escapes and unstaged dirs with next-step errors", () => {
  assert.throws(() => run(["hook", "../evil.sh", "--dir", "/tmp"]), /no paths/)
  assert.throws(() => run(["hook", "divide.sh", "--dir", "/tmp"]), /not a staged review program/)
})

test("verdict reads counts, the blocked table, and exits honest", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-reviewctl-v-"))
  const dir = join(tmp, "prog")
  mkdirSync(join(dir, "data", "review"), { recursive: true })
  writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({
    verdict: "reject",
    blocked: [{ id: "principles-1", severity: "P0", outcome: "introduced", claim: "the seam broke" }],
    advisory: [],
    adopt: [{ id: "tests-2", kind: "regression" }],
  }))
  const out = runCode(["verdict", dir, "--json"])
  assert.equal(out.code, 1, "a reject verdict exits 1 — honest codes compose")
  const v = JSON.parse(out.stdout.slice(out.stdout.indexOf("{")))
  assert.equal(v.verdict, "reject")
  assert.equal(v.blockedCount, 1)
  assert.equal(v.adoptCount, 1)
  assert.match(out.stdout, /principles-1/)
  rmSync(tmp, { recursive: true, force: true })
})

test("cleanup is signature-guarded and --dry-run changes nothing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-reviewctl-c-"))
  const staged = join(tmp, "prog")
  mkdirSync(join(staged, "hooks"), { recursive: true })
  writeFileSync(join(staged, "workflow.toml"), "id = \"x\"\n")
  const plain = join(tmp, "plain")
  mkdirSync(plain, { recursive: true })
  writeFileSync(join(plain, "keep.txt"), "x")

  assert.throws(() => run(["cleanup", plain]), /does not look like a staged review program/, "refuses to delete a non-staged dir")

  const dry = run(["cleanup", staged, "--dry-run"])
  assert.match(dry, /would remove/)
  assert.ok(existsSync(join(staged, "workflow.toml")), "dry-run deleted nothing")

  const real = run(["cleanup", staged])
  assert.match(real, /removed/)
  assert.equal(existsSync(staged), false)
  rmSync(tmp, { recursive: true, force: true })
})

test("gate returns the decision in isolation (json) and verdict exit codes compose", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-reviewctl-g-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = run(["gate", repo, "--base", "master", "--head", "feat", "--no-jev", "--json"])
  const g = JSON.parse(out.slice(out.indexOf("{")))
  assert.ok(["review", "skip"].includes(g.decision.action))
  assert.ok(Array.isArray(g.decision.roster))
  rmSync(tmp, { recursive: true, force: true })
})
