// The pr-review rail (templates/pr-review + `whl review` + the
// WHL_UNIT seam). Three layers pinned here:
//   1. the seam: a per-unit stage check receives WHL_UNIT (without it
//      a fan-out check cannot name its subject)
//   2. the verb: materialize / skip / refuse (prepareReview — pure)
//   3. the hooks: findings-check shape law, prove's decision model
//      (introduced | incomplete-fix | pre-existing | bogus | flaky |
//      refuted), divide-check's partition law, merge's cold verdict
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../src/engines/orchestrator.ts"
import { prepareReview, reviewReceipt, type ReviewArgs } from "../src/doors/review.ts"
import { prepareRun } from "../src/doors/run.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-pr-review-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const ROOT = join(import.meta.dirname, "..")
const TPL = join(ROOT, "templates", "pr-review")
const sh = (cmd: string, opts: { cwd?: string; env?: Record<string, string> } = {}) => {
  try {
    return { code: 0, out: execSync(cmd, { encoding: "utf8", cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) } }).trim() }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() }
  }
}
const hook = (name: string, cwd: string, env: Record<string, string> = {}) => sh(`bash hooks/${name}`, { cwd, env })

// ── 1. the seam: WHL_UNIT reaches the per-unit check ────────────────
{
  const shep = (): { port: ShepPort; spawned: string[] } => {
    const spawned: string[] = []
    const port: ShepPort = {
      setLayout: () => {},
      spawnWorker: (name, _kind, _brief, cwd) => {
        const id = name.slice(2)
        spawned.push(name)
        writeFileSync(join(cwd, "result.md"), "READY\n")
        writeFileSync(join(cwd, "log.txt"), `done ${id}\n`)
        return true
      },
      // the revise round's customer: a reprompted pane produces a
      // fresh done line, re-running the check (second red ends the
      // unit honestly — never a stall wait)
      reprompt: (name) => {
        const id = name.slice(2)
        for (const base of ["wlunit", "wlunit-solo"]) {
          const log = join(process.env.AGENTIC_OS_HOME!, base, "units", id, "log.txt")
          try { writeFileSync(log, `done ${id}\n`) } catch { /* not this run's unit */ }
        }
        return true
      },
      paneAlive: () => true,
      retire: () => {},
      retireAll: () => {},
      verify: () => "pane-reap: 0 remaining",
      wake: () => {},
      tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
    }
    return { port, spawned }
  }
  const run = (dir: string, port: ShepPort) =>
    runOrchestrator({ taskDir: dir, shep: port, gateCheckMs: 50, logPollMs: 50, stallMs: 60_000, briefGraceMs: 60_000, log: () => {} })

  test("WHL_UNIT: a fan-out unit's check learns WHICH unit it judges", async () => {
    const dir = join(process.env.AGENTIC_OS_HOME!, "wlunit")
    mkdirSync(join(dir, "hooks"), { recursive: true })
    writeFileSync(join(dir, "hooks", "seen.sh"), `printf '%s\\n' "$WHL_UNIT" >> seen.txt\n`)
    writeFileSync(
      join(dir, "workflow.toml"),
      `[workflow]
name = "wlunit"
worker_kind = "opencode"

[[stage]]
id = "wave"
topology = "fan-out"
grade = false
check = "bash hooks/seen.sh"
units = [
  { id = "aa", brief = "x" },
  { id = "bb", brief = "y" },
]
`,
    )
    const s = shep()
    const report = await run(dir, s.port)
    assert.equal(report.status, "done")
    const seen = readFileSync(join(dir, "seen.txt"), "utf8").split("\n").filter(Boolean).sort()
    assert.deepEqual(seen, ["aa", "bb"])
  })

  test("WHL_UNIT: a solo stage's check gets the stage's unit id", async () => {
    const dir = join(process.env.AGENTIC_OS_HOME!, "wlunit-solo")
    mkdirSync(join(dir, "hooks"), { recursive: true })
    writeFileSync(join(dir, "hooks", "seen.sh"), `printf '%s\\n' "$WHL_UNIT" >> seen.txt\nexit 1\n`)
    writeFileSync(
      join(dir, "workflow.toml"),
      `[workflow]
name = "wlunit-solo"
worker_kind = "opencode"

[[stage]]
id = "only"
topology = "solo"
grade = false
brief = "x"
check = "bash hooks/seen.sh"
`,
    )
    const s = shep()
    const report = await run(dir, s.port)
    // the check ran twice (red, revise round, red again) and the unit
    // ended HONESTLY failed — the pinned #198 round, addressed
    const seen = readFileSync(join(dir, "seen.txt"), "utf8").split("\n").filter(Boolean)
    assert.deepEqual(seen, ["only", "only"])
    assert.equal(report.status, "failed")
    assert.match(report.table.find((r) => r.unit === "only")!.result, /stage check failed \(after one revise round\)/)
  })
}

// ── 2. the verb: materialize / skip / refuse ────────────────────────
function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (args: string) => execSync(`git ${args}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  writeFileSync(join(where, "README.md"), "# demo\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

const mat = (over: Partial<ReviewArgs> & { repo: string }) => prepareReview(over as ReviewArgs, join(ROOT, "templates"))

test("review verb: materializes a program the door's own screens accept", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-rev-verb-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const r = mat({ repo, base: "main", head: "feat", out: join(tmp, "prog") })
  assert.ok(r.ok && !r.skipped, JSON.stringify(r))
  const cfg = readFileSync(join(r.dir, "data", "review", "config.sh"), "utf8")
  assert.match(cfg, /BASE_BRANCH='main'/)
  assert.match(cfg, /HEAD_BRANCH='feat'/)
  assert.match(cfg, /^TITLE='/m)
  // the repo's own INVARIANTS.md wins over the template seed
  writeFileSync(join(repo, "INVARIANTS.md"), "- INV-0 test-only invariant\n")
  const r2 = mat({ repo, base: "main", head: "feat", out: join(tmp, "prog2") })
  assert.ok(r2.ok && !r2.skipped)
  assert.match(readFileSync(join(r2.dir, "data", "INVARIANTS.md"), "utf8"), /INV-0/)
  // the trace rides along for the divide stage
  mkdirSync(join(tmp, "trace", "units", "alice"), { recursive: true })
  writeFileSync(join(tmp, "trace", "units", "alice", "result.md"), "I did src/wait.ts\n")
  const r3 = mat({ repo, base: "main", head: "feat", traceDir: join(tmp, "trace"), out: join(tmp, "prog3") })
  assert.ok(r3.ok && !r3.skipped)
  assert.ok(existsSync(join(r3.dir, "data", "trace", "units", "alice", "result.md")))
  const check = prepareRun(r3.dir, { check: true })
  assert.ok(check.ok, `admission refused: ${check.ok ? "" : check.why}`)
  rmSync(tmp, { recursive: true, force: true })
})

test("review verb: docs-only diff skips BEFORE anything is levied", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-rev-skip-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  execSync("git checkout -qb docs main && echo more > GUIDE.md && git add -A && git commit -qm docs", { cwd: repo })
  const r = mat({ repo, base: "main", head: "docs" })
  assert.ok(r.ok && r.skipped)
  assert.match(reviewReceipt(r), /review: skip — docs-only diff/)
  const same = mat({ repo, base: "main", head: "main" })
  assert.ok(!same.ok && same.code === 2)
  rmSync(tmp, { recursive: true, force: true })
})

// ── 3. the hooks ────────────────────────────────────────────────────
type Prog = { dir: string; head: string; base: string }
function progFixture(setup: (p: Prog) => void): Prog {
  const tmp = mkdtempSync(join(tmpdir(), "aos-rev-hook-"))
  const dir = join(tmp, "prog")
  cpSync(TPL, dir, { recursive: true })
  const p: Prog = { dir, head: join(dir, "data", "review", "head"), base: join(dir, "data", "review", "base") }
  mkdirSync(join(p.head, "test", "review"), { recursive: true })
  mkdirSync(join(p.base, "test", "review"), { recursive: true })
  mkdirSync(join(p.head, "src"), { recursive: true })
  mkdirSync(join(p.base, "src"), { recursive: true })
  writeFileSync(join(p.head, "src", "wait.ts"), "")
  writeFileSync(join(p.base, "src", "wait.ts"), "")
  mkdirSync(join(dir, "units", "principles"), { recursive: true })
  writeFileSync(join(dir, "data", "review", "config.sh"), "REPO='/tmp/prog-fixture'\nBASE_BRANCH='main'\nBASE_SHA='deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'\nHEAD_BRANCH='feat'\nHEAD_SHA='cafebabecafebabecafebabecafebabecafebabe'\nTITLE='fixture'\nAUTHOR=''\nMERGE_CMD=''\n")
  setup(p)
  return p
}
const finding = (over: Record<string, unknown>) =>
  JSON.stringify({ id: "principles-1", lens: "principles", severity: "P1", claim: "claim", location: { file: "src/wait.ts", line_start: 1 }, ...over })

test("findings-check: shape law — the four refusals and the pass", () => {
  const ok = progFixture((p) => {
    writeFileSync(join(p.dir, "units", "principles", "findings.jsonl"), "")
    writeFileSync(join(p.dir, "units", "principles", "coverage.md"), "traced src/wait.ts:1 src/other.ts:2 src/third.ts:3; set aside docs (declined)\n")
  })
  assert.equal(hook("findings-check.sh", ok.dir, { WHL_UNIT: "principles" }).code, 0, "empty findings + real coverage passes")

  const badJson = progFixture((p) => {
    writeFileSync(join(p.dir, "units", "principles", "findings.jsonl"), "{not json")
    writeFileSync(join(p.dir, "units", "principles", "coverage.md"), "src/wait.ts:1 src/x.ts:2 src/y.ts:3\n")
  })
  assert.match(hook("findings-check.sh", badJson.dir, { WHL_UNIT: "principles" }).out, /not JSON/)

  const p0NoRepro = progFixture((p) => {
    writeFileSync(join(p.dir, "units", "principles", "findings.jsonl"), finding({ severity: "P0" }))
    writeFileSync(join(p.dir, "units", "principles", "coverage.md"), "src/wait.ts:1 src/x.ts:2 src/y.ts:3\n")
  })
  assert.match(hook("findings-check.sh", p0NoRepro.dir, { WHL_UNIT: "principles" }).out, /P0 without repro/)

  const thin = progFixture((p) => {
    writeFileSync(join(p.dir, "units", "principles", "findings.jsonl"), "")
    writeFileSync(join(p.dir, "units", "principles", "coverage.md"), "I looked at it, seemed fine\n")
  })
  assert.match(hook("findings-check.sh", thin.dir, { WHL_UNIT: "principles" }).out, /thin coverage|only [0-9] file:line/)

  const wrongLens = progFixture((p) => {
    writeFileSync(join(p.dir, "units", "principles", "findings.jsonl"), finding({ lens: "tests", id: "tests-1" }))
    writeFileSync(join(p.dir, "units", "principles", "coverage.md"), "src/wait.ts:1 src/x.ts:2 src/y.ts:3\n")
  })
  assert.match(hook("findings-check.sh", wrongLens.dir, { WHL_UNIT: "principles" }).out, /lens is tests/)
})

test("prove: the six outcomes of the decision model", () => {
  // HEAD waits badly (contains sleep), BASE waits well — and the diff
  // touches src/wait.ts; an unrelated file carries a pre-existing bug.
  const p = progFixture((x) => {
    writeFileSync(join(x.head, "src", "wait.ts"), "export const settle = async () => { await sleep(5000) }\n")
    writeFileSync(join(x.base, "src", "wait.ts"), "export const settle = async (panes) => { for (const p of panes) while (p.working) await tick() }\n")
    writeFileSync(join(x.head, "src", "legacy.ts"), "export const old = () => { sleep(1) }\n")
    writeFileSync(join(x.base, "src", "legacy.ts"), "export const old = () => { sleep(1) }\n")
    writeFileSync(join(x.dir, "data", "review", "files.txt"), "src/wait.ts\n")
    // introduced: fails on HEAD (asserts observed wait), passes on BASE
    writeFileSync(
      join(x.head, "test", "review", "principles-1.test.ts"),
      `import assert from "node:assert/strict"; import { readFileSync } from "node:fs"\nassert.ok(!/sleep\\(/.test(readFileSync("src/wait.ts", "utf8")), "INV-1: the wait must observe state, not sleep")\n`,
    )
    // incomplete-fix: fails on BOTH (neither side observes), and the diff touches its file
    writeFileSync(
      join(x.head, "test", "review", "principles-2.test.ts"),
      `import assert from "node:assert/strict"; import { readFileSync } from "node:fs"\nassert.ok(readFileSync("src/wait.ts", "utf8").includes("observe"), "INV-1 twin: neither side observes — both must")\n`,
    )
    // pre-existing: fails on BOTH, file never in the diff
    writeFileSync(
      join(x.head, "test", "review", "principles-3.test.ts"),
      `import assert from "node:assert/strict"; import { readFileSync } from "node:fs"\nassert.ok(!/sleep\\(/.test(readFileSync("src/legacy.ts", "utf8")), "pre-existing bug outside the diff")\n`,
    )
    // bogus: fails to load
    writeFileSync(join(x.head, "test", "review", "principles-4.test.ts"), `import "no-such-module-xyz"\n`)
    // flaky: fails on the first run only (marker file)
    writeFileSync(
      join(x.head, "test", "review", "principles-5.test.ts"),
      `import assert from "node:assert/strict"; import { existsSync, writeFileSync } from "node:fs"\nif (!existsSync(".flap")) { writeFileSync(".flap", "1"); assert.equal(1, 2, "first-run failure") }\n`,
    )
    // refuted: passes on HEAD
    writeFileSync(join(x.head, "test", "review", "principles-6.test.ts"), `import assert from "node:assert/strict"\nassert.equal(1, 1)\n`)
    const rows = [
      finding({ id: "principles-1", severity: "P0", invariant: "INV-1", repro: { test_path: "test/review/principles-1.test.ts" } }),
      finding({ id: "principles-2", severity: "P1", invariant: "INV-1", repro: { test_path: "test/review/principles-2.test.ts" } }),
      finding({ id: "principles-3", severity: "P1", location: { file: "src/legacy.ts", line_start: 1 }, repro: { test_path: "test/review/principles-3.test.ts" } }),
      finding({ id: "principles-4", severity: "P0", repro: { test_path: "test/review/principles-4.test.ts" } }),
      finding({ id: "principles-5", severity: "P1", repro: { test_path: "test/review/principles-5.test.ts" } }),
      finding({ id: "principles-6", severity: "P0", repro: { test_path: "test/review/principles-6.test.ts" } }),
      finding({ id: "principles-7", severity: "P2" }),
    ].join("\n")
    writeFileSync(join(x.dir, "units", "principles", "findings.jsonl"), rows)
  })
  const r = hook("prove.sh", p.dir)
  assert.equal(r.code, 0, `prove must exit 0 (verdict produced): ${r.out}`)
  const v = JSON.parse(readFileSync(join(p.dir, "data", "review", "verdict.json"), "utf8"))
  assert.equal(v.verdict, "reject")
  const byId = Object.fromEntries(v.blocked.map((b: { id: string }) => [b.id, b.outcome]))
  assert.equal(byId["principles-1"], "introduced")
  assert.equal(byId["principles-2"], "incomplete-fix")
  assert.deepEqual(
    v.advisory.map((a: { id: string }) => a.id).sort(),
    ["principles-3", "principles-4", "principles-5", "principles-6", "principles-7"],
  )
  const adv = Object.fromEntries(v.advisory.map((a: { id: string; why: string }) => [a.id, a.why]))
  assert.match(adv["principles-3"], /pre-existing/)
  assert.match(adv["principles-4"], /load/)
  assert.match(adv["principles-5"], /flaky/)
  assert.match(adv["principles-6"], /refuted/)
  // the ledger carries one line per finding (the lens proof-rate metric)
  const ledger = readFileSync(join(p.dir, "data", "review", "ledger.jsonl"), "utf8").trim().split("\n")
  assert.equal(ledger.length, 7)
  rmSync(p.dir, { recursive: true, force: true })
})

test("prove: zero blocking findings → accept, exit 0", () => {
  const p = progFixture((x) => {
    writeFileSync(join(x.dir, "units", "principles", "findings.jsonl"), finding({ id: "principles-9", severity: "P3", claim: "nit" }))
    writeFileSync(join(x.dir, "data", "review", "files.txt"), "src/wait.ts\n")
  })
  assert.equal(hook("prove.sh", p.dir).code, 0)
  const v = JSON.parse(readFileSync(join(p.dir, "data", "review", "verdict.json"), "utf8"))
  assert.equal(v.verdict, "accept")
  rmSync(p.dir, { recursive: true, force: true })
})

test("divide-check: the partition law", () => {
  const mk = (blocked: unknown[], feedback: Record<string, string>, map: boolean) => {
    const p = progFixture((x) => {
      writeFileSync(join(x.dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: blocked.length ? "reject" : "accept", blocked, advisory: [] }))
      if (Object.keys(feedback).length) mkdirSync(join(x.dir, "feedback"), { recursive: true })
      for (const [f, text] of Object.entries(feedback)) writeFileSync(join(x.dir, "feedback", f), text)
      if (map) writeFileSync(join(x.dir, "feedback", "MAP.md"), "evidence\n")
    })
    return p
  }
  const blocked = [{ id: "principles-1", severity: "P0", claim: "c" }, { id: "tests-1", severity: "P1", claim: "c" }]
  const good = mk(blocked, { "alice.md": "principles-1 yours\n", "bob.md": "tests-1 yours\n" }, true)
  assert.match(hook("divide-check.sh", good.dir).out, /covered exactly once/)

  const nobody = mk(blocked, { "alice.md": "principles-1 yours\n" }, true)
  assert.match(hook("divide-check.sh", nobody.dir).out, /tests-1 reaches nobody/)

  const twice = mk(blocked, { "alice.md": "principles-1 tests-1\n", "bob.md": "tests-1\n" }, true)
  assert.match(hook("divide-check.sh", twice.dir).out, /exactly one owner/)

  const invented = mk(blocked, { "alice.md": "principles-1 and principles-8\n" }, true)
  assert.match(hook("divide-check.sh", invented.dir).out, /invents/)

  const noMap = mk(blocked, { "alice.md": "principles-1 tests-1\n" }, false)
  assert.match(hook("divide-check.sh", noMap.dir).out, /MAP.md missing/)

  const accepted = mk([], { "alice.md": "leftover\n" }, false)
  assert.match(hook("divide-check.sh", accepted.dir).out, /accept but feedback/)

  const acceptClean = mk([], {}, false)
  assert.match(hook("divide-check.sh", acceptClean.dir).out, /accept, no feedback/)
  for (const p of [good, nobody, twice, invented, noMap, accepted, acceptClean]) rmSync(p.dir, { recursive: true, force: true })
})

test("merge: the cold verdict — accept merges, reject exits 1 honestly", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-rev-merge-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const base = execSync("git rev-parse main", { cwd: repo, encoding: "utf8" }).trim()
  const head = execSync("git rev-parse feat", { cwd: repo, encoding: "utf8" }).trim()
  const p = progFixture((x) => {
    writeFileSync(join(x.dir, "data", "review", "config.sh"), `REPO='${repo}'\nBASE_BRANCH='main'\nBASE_SHA='${base}'\nHEAD_BRANCH='feat'\nHEAD_SHA='${head}'\nTITLE='t'\nAUTHOR=''\nMERGE_CMD=''\n`)
    writeFileSync(join(x.dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "reject", blocked: [{ id: "x-1" }], advisory: [] }))
  })
  assert.equal(hook("merge.sh", p.dir).code, 1)
  writeFileSync(join(p.dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [], advisory: [] }))
  const ok = hook("merge.sh", p.dir)
  assert.equal(ok.code, 0, ok.out)
  const onMain = execSync("git log main --oneline -1", { cwd: repo, encoding: "utf8" }).trim()
  assert.match(onMain, /pr-review: accept/)
  const mergedParents = execSync("git rev-list --parents -n 1 main", { cwd: repo, encoding: "utf8" }).trim().split(" ")
  assert.equal(mergedParents.length, 3, "a --no-ff merge commit (two parents)")
  rmSync(tmp, { recursive: true, force: true })
})

test("intake: builds both checkouts, the diff, and one shuffled hunk order per lens", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-rev-intake-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const base = execSync("git rev-parse main", { cwd: repo, encoding: "utf8" }).trim()
  const head = execSync("git rev-parse feat", { cwd: repo, encoding: "utf8" }).trim()
  const p = progFixture((x) => {
    writeFileSync(join(x.dir, "data", "review", "config.sh"), `REPO='${repo}'\nBASE_BRANCH='main'\nBASE_SHA='${base}'\nHEAD_BRANCH='feat'\nHEAD_SHA='${head}'\nTITLE='feat -> main'\nAUTHOR=''\nMERGE_CMD=''\n`)
  })
  const r = hook("intake.sh", p.dir)
  assert.equal(r.code, 0, r.out)
  for (const side of ["head", "base"]) assert.ok(existsSync(join(p.dir, "data", "review", side, ".git")), `${side} is a worktree`)
  assert.ok(readFileSync(join(p.dir, "data", "review", "diff.patch"), "utf8").includes("waitFast"))
  assert.equal(readFileSync(join(p.dir, "data", "review", "files.txt"), "utf8").trim(), "src/wait.ts")
  assert.match(readFileSync(join(p.dir, "data", "review", "pr.md"), "utf8"), /# feat -> main/)
  for (const lens of ["principles", "tests", "momentum", "questions"]) {
    const order = readFileSync(join(p.dir, "data", "review", `order-${lens}.txt`), "utf8")
    assert.equal((order.match(/^@@/gm) ?? []).length, 1, "every order carries all hunks")
  }
  // idempotent re-entry: the gate re-fires safely
  assert.equal(hook("intake.sh", p.dir).code, 0)
  rmSync(tmp, { recursive: true, force: true })
})
