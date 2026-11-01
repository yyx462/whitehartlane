// the stop rule's own seat (2026-11-01) — the laws, pinned:
//   1. findings cluster into root-cause buckets (r11's receipt: 11 → 7)
//   2. novel vs stuck — persistence disqualifies, not enables
//   3. good faith first (min_rounds), P0 blocks, K consecutive quiet
//   4. the owner's parameters ride the BASE commit (never the PR's own file)
//   5. writer≡reader: the door's STOP_HISTORY grammar ↔ the cold twin's
//      eligibility — two implementations, one answer
//   6. the banner: merge.sh prints it ONLY on eligibility; the stop.json
//      seat is output (identity-neutral)
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DEFAULT_STOP, clustersOf, stopConfigOf, stopEligibility } from "../src/doors/stop-rule.ts"

const f = (id: string, file: string, line: number, severity = "P1") => ({
  id,
  severity,
  location: { file, line_start: line },
})

test("clusters: three lenses finding one bug collapse into one bucket (the r11 receipt)", () => {
  // the ACTUAL shape of round 11: momentum-920 / principles-103 /
  // questions-27 all sat in ship.ts's verdictsForBranch; two more
  // pairs collapsed in ship-supervisor.ts and merge.sh
  const blocked = [
    f("momentum-920", "src/doors/ship.ts", 75),
    f("principles-103", "src/doors/ship.ts", 121),
    f("questions-27", "src/doors/ship.ts", 72),
    f("principles-101", "src/doors/ship-supervisor.ts", 33),
    f("questions-28", "src/doors/ship-supervisor.ts", 33),
    f("principles-105", "templates/pr-review/hooks/merge.sh", 63),
    f("questions-29", "templates/pr-review/hooks/merge.sh", 64),
    f("principles-107", "bin/whitehartlane", 764),
    f("principles-108", "templates/pr-review/hooks/merge.sh", 41),
    f("principles-109", "src/doors/project.ts", 109),
    f("questions-30", "src/doors/review.ts", 1095),
  ]
  assert.equal(clustersOf(blocked).length, 7, "11 findings → 7 buckets (four collapses: ship.ts×2→1 pair, supervisor pair, merge.sh triple)")
})

test("novel vs stuck: persistence disqualifies eligibility, novelty within bounds enables it", () => {
  const quietRound = [f("a-1", "src/doors/ship.ts", 10)]
  const sameAgain = [f("a-1", "src/doors/ship.ts", 12)]
  // stuck: the same bucket in two consecutive rounds → NOT eligible
  const stuck = stopEligibility([[quietRound[0]], sameAgain], DEFAULT_STOP)
  assert.equal(stuck.eligible, false)
  assert.match(stuck.why, /stuck/)
  // quiet: two rounds, each within novelty bounds, nothing stuck,
  // no predecessor-reuse → eligible (needs K+1 rounds of history:
  // each window round is compared to ITS predecessor)
  const q1 = [f("a-1", "src/doors/ship.ts", 10)]
  const q2 = [f("a-1", "src/doors/ship.ts", 10)] // same bucket = zero novel... but ALSO stuck!
  // careful: same bucket across rounds IS stuck — quiet means the SAME
  // work not reappearing at all: an empty round
  const hist = [[f("x-1", "src/doors/run.ts", 5)], [], []]
  const quiet = stopEligibility(hist, DEFAULT_STOP)
  assert.equal(quiet.eligible, true, `two consecutive empty rounds after a finding = diminishing: ${quiet.why}`)
  // the owner's N=1 tolerance, BY DESIGN: one novel root cause per round
  // for 2 consecutive rounds, nothing stuck, no P0 → eligible. A steady
  // one-new-thing drip is what the owner DECLARED tolerable; two is not.
  const drip = stopEligibility([[f("a", "a.ts", 1)], [f("b", "b.ts", 1)], [f("c", "c.ts", 1)]], DEFAULT_STOP)
  assert.equal(drip.eligible, true, `novel 1 ≤ 1 for 2 rounds is the measured tolerance: ${drip.why}`)
  // novel spike: TWO fresh mechanisms in a round → NOT eligible (the ratchet)
  const ratchet = stopEligibility([[f("a", "a.ts", 1)], [f("b", "b.ts", 1)], [f("c", "c.ts", 1), f("d", "d.ts", 1)]], DEFAULT_STOP)
  assert.equal(ratchet.eligible, false)
  assert.match(ratchet.why, /novel/)
})

test("good faith first: round 1 never opens the exit; a P0 blocks the window", () => {
  const r1 = stopEligibility([[f("a-1", "a.ts", 1)]], DEFAULT_STOP)
  assert.equal(r1.eligible, false)
  assert.match(r1.why, /good faith/)
  const p0 = stopEligibility([[f("a", "a.ts", 1)], [], [f("p", "a.ts", 1, "P0")]], DEFAULT_STOP)
  assert.equal(p0.eligible, false)
  assert.match(p0.why, /P0/)
})

test("stopConfigOf: the owner's parameters ride the BASE commit, never the PR's own file", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-stop-seat-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(repo, { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "a.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    const base = g("rev-parse", "main").trim()
    g("checkout", "-qb", "feat")
    // the PR's OWN file loosens everything — it must not govern
    writeFileSync(join(repo, "review-gate.toml"), "[stop]\nrounds = 1\nnovel_max = 99\nmin_rounds = 1\n")
    g("add", "-A")
    g("commit", "-qm", "loose")
    assert.deepEqual(stopConfigOf(repo, { base }), DEFAULT_STOP, "the base's absence means the measured defaults — never the PR's own loose file")
    // a base that CARRIES a contract governs (checkout FIRST, then
    // write — a dirty worktree refuses the checkout)
    execFileSync("git", ["-C", repo, "checkout", "-q", "main"], { stdio: "ignore" })
    writeFileSync(join(repo, "review-gate.toml"), "[stop]\nrounds = 3\n")
    g("add", "-A")
    g("commit", "-qm", "contract on base")
    const base2 = g("rev-parse", "main").trim()
    execFileSync("git", ["-C", repo, "checkout", "-q", "feat"], { stdio: "ignore" })
    const cfg = stopConfigOf(repo, { base: base2 })
    assert.equal(cfg.rounds, 3)
    assert.equal(cfg.novelMax, DEFAULT_STOP.novelMax, "unspecified keys keep the measured defaults")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("writer≡reader: the door's STOP_HISTORY grammar and the cold twin's eligibility agree", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-stop-twin-"))
  try {
    // three rounds of real history: a finding, an empty round, an
    // empty round — ELIGIBLE under the module
    const history = [
      [{ id: "x-1", severity: "P1", location: { file: "src/doors/run.ts", line_start: 5 } }],
      [],
      [],
    ]
    const mine = stopEligibility(history, DEFAULT_STOP)
    assert.equal(mine.eligible, true)
    // the door's writer shape (review.ts): {buckets, p0}, oldest first
    const handDown = JSON.stringify(history.map((r) => ({ buckets: clustersOf(r), p0: r.some((b) => b.severity === "P0") })))
    // the twin gets the PRIOR rounds + the current verdict (the third
    // round, empty, as the live verdict)
    const verdictPath = join(tmp, "verdict.json")
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: [] }))
    const twin = spawnSync("node", [
      join(import.meta.dirname, "..", "templates", "pr-review", "hooks", "stop-rule.mjs"),
      verdictPath,
      JSON.parse(handDown).length ? handDown : "[]",
      JSON.stringify(DEFAULT_STOP),
    ], { encoding: "utf8" })
    assert.equal(twin.status, 0, twin.stderr)
    assert.ok(existsSync(join(tmp, "stop.json")), "the twin writes its record seat")
    const seat = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))
    assert.equal(seat.eligible, mine.eligible, `the twin says ${seat.eligible}, the module says ${mine.eligible} — one question, one answer`)
    assert.match(twin.stdout, /diminishing returns/, "the banner prints on eligibility")
    // and the stuck case must agree too
    const stuckDown = JSON.stringify([{ buckets: clustersOf(history[0]), p0: false }, { buckets: clustersOf(history[0]), p0: false }])
    writeFileSync(verdictPath, JSON.stringify({ verdict: "reject", blocked: history[0] }))
    const twin2 = spawnSync("node", [
      join(import.meta.dirname, "..", "templates", "pr-review", "hooks", "stop-rule.mjs"),
      verdictPath,
      stuckDown,
      JSON.stringify(DEFAULT_STOP),
    ], { encoding: "utf8" })
    assert.equal(twin2.status, 0, twin2.stderr)
    const seat2 = JSON.parse(readFileSync(join(tmp, "stop.json"), "utf8"))
    assert.equal(seat2.eligible, false, "the same bucket three rounds running is STUCK, not diminishing")
    assert.equal(twin2.stdout.trim(), "", "silence is the ordinary state — not-eligible is not news")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the banner: merge.sh prints the gate's declaration on an eligible reject, and stays silent otherwise", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-stop-banner-"))
  const TEMPLATES = join(import.meta.dirname, "..", "templates")
  try {
    const prog = join(tmp, "prog")
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(join(TEMPLATES, "pr-review", "hooks", "merge.sh"), "utf8"))
    writeFileSync(join(prog, "hooks", "stop-rule.mjs"), readFileSync(join(TEMPLATES, "pr-review", "hooks", "stop-rule.mjs"), "utf8"))
    const mk = (history: string, blocked: unknown[]) => {
      const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
      writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "reject", blocked }))
      writeFileSync(join(prog, "data", "review", "config.sh"), [
        `REPO='${tmp}'`, `BASE_BRANCH='main'`, `BASE_SHA='${"a".repeat(40)}'`,
        `HEAD_BRANCH='feat'`, `HEAD_SHA='${"b".repeat(40)}'`, `TITLE='t'`, `AUTHOR=''`,
        `MERGE_CMD=''`, `PR_NUM=''`, `STOP_HISTORY=${sq(history)}`, `STOP_CFG=${sq('{"rounds":2,"novelMax":1,"minRounds":2}')}`, "",
      ].join("\n"))
      return spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8" })
    }
    // eligible: a finding round, then two empty rounds (the verdict carries the last empty)
    const hist = JSON.stringify([
      { buckets: ["run.ts:0"], p0: false },
      { buckets: [], p0: false },
    ])
    const eligible = mk(hist, [])
    assert.notEqual(eligible.status, 0, "a reject still fails the chain honestly")
    assert.match(eligible.stderr, /diminishing returns/, `the gate must SAY the loop's honest end (stderr: ${eligible.stderr.slice(-300)})`)
    // not eligible: silence (the ordinary state) — TWO novel root causes
    // in the round (a one-per-round drip is the owner's N=1 tolerance
    // and DOES banner; two is the ratchet's signature)
    const noisy = JSON.stringify([{ buckets: ["a.ts:0"], p0: false }, { buckets: ["b.ts:0"], p0: false }])
    const ordinary = mk(noisy, [f("n-1", "c.ts", 1), f("n-2", "d.ts", 1)])
    assert.notEqual(ordinary.status, 0)
    assert.ok(!/diminishing returns/.test(ordinary.stderr), "no banner when the criterion does not hold")
    // old programs (no STOP_HISTORY) keep working, no banner, no crash
    writeFileSync(join(prog, "data", "review", "config.sh"), `REPO='${tmp}'\nMERGE_CMD=''\n`)
    const legacy = spawnSync("bash", [join(prog, "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8" })
    assert.notEqual(legacy.status, 0)
    assert.ok(!/diminishing returns/.test(legacy.stderr))
    assert.ok(!/stop-rule/.test(legacy.stderr), "the twin's absence is not an error (backward compat)")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the replay: the measured defaults never fire spuriously on this PR's own 11-round history", () => {
  // the receipt from the tuning run (2026-11-01): novelty per round
  // 2,1,0,2,1,3,4,2,5,7,4 with stuck buckets in every quiet gap —
  // the rule held the door shut across the whole ratchet, exactly as
  // designed. Distilled to shape: no two consecutive rounds were both
  // novel≤1 with nothing stuck and no P0.
  const bucket = (file: string) => [{ id: file, severity: "P1", location: { file, line_start: 1 } }]
  const shapes = [
    { novel: 2, stuck: 0 }, { novel: 1, stuck: 1 }, { novel: 0, stuck: 1 },
    { novel: 2, stuck: 0 }, { novel: 1, stuck: 1 }, { novel: 3, stuck: 1 },
    { novel: 4, stuck: 1 }, { novel: 2, stuck: 1 }, { novel: 5, stuck: 3 },
    { novel: 7, stuck: 1 }, { novel: 4, stuck: 3 },
  ]
  // model each round as `novel` fresh buckets + `stuck` carried ones
  let carried: string[] = []
  const history: { id: string; severity: string; location: { file: string; line_start: number } }[][] = []
  let n = 0
  for (const s of shapes) {
    const round: { id: string; severity: string; location: { file: string; line_start: number } }[] = []
    for (let i = 0; i < s.novel; i++) round.push({ id: `n${n++}`, severity: "P1", location: { file: `f${n}.ts`, line_start: 1 } })
    for (const c of carried) round.push({ id: `c-${c}`, severity: "P1", location: { file: c, line_start: 1 } })
    carried = round.map((r) => r.location.file).slice(-s.stuck)
    history.push(round)
  }
  for (let i = 1; i <= history.length; i++) {
    const e = stopEligibility(history.slice(0, i), DEFAULT_STOP)
    assert.equal(e.eligible, false, `round ${i} must not open the exit (got: ${e.why})`)
  }
})
