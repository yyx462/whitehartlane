import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareRun } from "../src/doors/run.ts"
import { prepareReview } from "../src/doors/review.ts"
import {
  BANDS,
  LENSES,
  appendLedgerRow,
  classStats,
  classify,
  decideGate,
  gateFeatures,
  gateReceipt,
  ledgerPath,
  runGate,
  shipConfigOf,
  type GateFeatures,
} from "../src/doors/review-gate.ts"

// The gate (review-gate.ts): facts from a script, judgment from one
// `jev run` (four noul, one per lens), enforcement back in the script.
// Every fail-safe direction is pinned here: jev down → full rail;
// unparsable answer → full rail; missing probability → the lens RUNS.
// The dropout keeps the skip region measured — fresh class audits
// every skip, greens decay the rate, a red resets it.
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-gate-"))
process.env.WHL_GATE_LEDGER = join(process.env.AGENTIC_OS_HOME, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const STATS0 = { greens: 0, reds: 0, audits: 0, rate: 1.0 }

const mkFeatures = (over: Partial<GateFeatures> = {}): GateFeatures => ({
  repo: "/tmp/r",
  base: "master",
  head: "feat",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  files: ["src/a.ts"],
  churn: 40,
  klass: "code_small",
  hotFiles: [],
  ...over,
})

test("classify: docs-only / test-only / churn boundary", () => {
  assert.equal(classify(["README.md", "docs/x.md"], 5), "docs_only")
  assert.equal(classify(["test/a.test.ts"], 5), "test_only")
  assert.equal(classify(["src/a.ts"], 150), "code_small")
  assert.equal(classify(["src/a.ts"], 151), "code_large")
  // one code file among docs kills docs-only (assets/ can hold code)
  assert.equal(classify(["README.md", "src/gen.ts"], 5), "code_small")
})

// ---- strictness bands (2026-10-30): a band selects NUMBERS, never
// outcomes — the fail-safe and the red-reset ride every band
test("bands: the bar moves; the fail-safe does not", () => {
  const ps = { principles: 0.2, tests: 0.2, momentum: 0.2, questions: 0.2 } // jev ~80% sure no lens is needed
  // medium (0.35): all four fall below the bar → skip
  const med = decideGate(mkFeatures(), ps, STATS0, 0.99)
  assert.equal(med.action, "skip")
  // strict (0.15): 0.2 clears the bar → every lens reviews
  const strict = decideGate(mkFeatures(), ps, STATS0, 0.99, BANDS.strict)
  assert.equal(strict.action, "review")
  assert.deepEqual(strict.roster, [...LENSES])
  // loose (0.60): even a 0.5 doubt keeps nothing — the easy bypass
  const loose = decideGate(mkFeatures(), { principles: 0.5, tests: 0.5, momentum: 0.5, questions: 0.5 }, STATS0, 0.99, BANDS.loose)
  assert.equal(loose.action, "skip")
  // jev down → full rail under EVERY band (fail-safe above all bands)
  for (const band of Object.values(BANDS)) {
    assert.deepEqual(decideGate(mkFeatures(), null, STATS0, 0.99, band).roster, [...LENSES])
  }
})

test("bands: strict's hot-file rule — a fact outranks the judgment", () => {
  const f = mkFeatures({ hotFiles: [{ file: "hooks.ts", findings: 3 }] })
  const ps = { principles: 0.01, tests: 0.01, momentum: 0.01, questions: 0.01 } // jev: skip everything
  const d = decideGate(f, ps, STATS0, 0.99, BANDS.strict)
  assert.equal(d.action, "review")
  assert.deepEqual(d.roster, [...LENSES])
  assert.match(d.why, /strict band: hot file/)
  // medium keeps today's behavior: hot files FEED jev, they do not force
  assert.equal(decideGate(f, ps, STATS0, 0.99).action, "skip")
})

test("bands: the audit ladder moves with the band", () => {
  const row = (n: string) => ({ repo: "r", head: n, headSha: n, klass: "code_small", files: 1, churn: 1, hot: [], ps: null, roster: [], action: "skip", audit: false }) as never
  const green = new Map([
    ["1", { red: false }],
    ["2", { red: false }],
    ["3", { red: false }],
    ["4", { red: false }],
    ["5", { red: false }],
  ])
  const rows = [row("1"), row("2"), row("3"), row("4"), row("5")]
  // 5 greens: medium still audits a quarter, strict half, loose one in twenty
  assert.equal(classStats(rows, green, "code_small").rate, 0.25)
  assert.equal(classStats(rows, green, "code_small", BANDS.strict).rate, 0.5)
  assert.equal(classStats(rows, green, "code_small", BANDS.loose).rate, 0.05)
})

test("shipConfigOf: review-gate.toml is the per-project contract", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-gate-cfg-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  // absent → medium, auto off
  const bare = shipConfigOf(repo)
  assert.deepEqual([bare.auto, bare.strictness], [false, "medium"])
  // the contract, parsed
  writeFileSync(join(repo, "review-gate.toml"), 'auto = true\nmodel = "acme/strong"\nstrictness = "strict"\n')
  const full = shipConfigOf(repo)
  assert.deepEqual([full.auto, full.strictness], [true, "strict"])
  assert.equal(full.model, "acme/strong")
  // unknown band and garbage toml → medium, never vanish
  writeFileSync(join(repo, "review-gate.toml"), 'strictness = "yolo"\n')
  assert.equal(shipConfigOf(repo).strictness, "medium")
  writeFileSync(join(repo, "review-gate.toml"), "not toml at all {{{\n")
  assert.equal(shipConfigOf(repo).strictness, "medium")
  rmSync(tmp, { recursive: true, force: true })
})

test("runGate: the repo's band decides, and the ledger row names it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-gate-band-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  writeFileSync(join(repo, "review-gate.toml"), 'strictness = "strict"\n')
  // this test's OWN ledger — file-order isolation: other tests in
  // this file count rows in the shared one
  const prevLedger = process.env.WHL_GATE_LEDGER
  process.env.WHL_GATE_LEDGER = join(tmp, "band.jsonl")
  // jev ~80% sure no lens is needed — medium would skip; strict reviews
  const stub = jevStub(tmp, { principles: 0.2, tests: 0.2, momentum: 0.2, questions: 0.2 })
  process.env.WHL_JEV_BIN = stub
  try {
    const { decision } = runGate(repo, "main", "feat")
    assert.equal(decision.action, "review")
    const row = JSON.parse(readFileSync(ledgerPath(), "utf8").trim().split("\n").at(-1)!)
    assert.equal(row.strictness, "strict")
  } finally {
    delete process.env.WHL_JEV_BIN
    process.env.WHL_GATE_LEDGER = prevLedger
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("decideGate: jev unavailable → fail-safe full rail", () => {
  const d = decideGate(mkFeatures(), null, STATS0, 0.99)
  assert.equal(d.action, "review")
  assert.deepEqual(d.roster, [...LENSES])
  assert.match(d.why, /fail-safe/)
})

test("decideGate: roster = lenses clearing the bar; a MISSING p never drops a lens", () => {
  const ps = { principles: 0.9, tests: 0.8, momentum: 0.2, questions: 0.34 }
  const d = decideGate(mkFeatures(), ps, STATS0, 0.99)
  assert.equal(d.action, "review")
  assert.deepEqual(d.roster, ["principles", "tests"])
  // missing probability for questions → the lens RUNS (fail-safe)
  const d2 = decideGate(mkFeatures(), { principles: 0.9, tests: 0.2, momentum: 0.2 }, STATS0, 0.99)
  assert.deepEqual(d2.roster, ["principles", "questions"])
})

test("decideGate: all-low ps → skip on a decayed class; a fresh class audits every skip", () => {
  const ps = { principles: 0.1, tests: 0.1, momentum: 0.1, questions: 0.1 }
  const decayed = { greens: 5, reds: 0, audits: 5, rate: 0.25 }
  const skip = decideGate(mkFeatures(), ps, decayed, 0.99) // roll above 0.25 → skip stands
  assert.equal(skip.action, "skip")
  assert.equal(skip.audit, false)
  const audited = decideGate(mkFeatures(), ps, decayed, 0.1) // roll under rate → run anyway
  assert.equal(audited.action, "skip") // the JUDGMENT stays skip; the escalation is the flag
  assert.equal(audited.audit, true)
  assert.match(audited.why, /dropout/)
  // fresh class: rate 1.0 — even roll 0.999 audits (the skip region is
  // never unmeasured while the class has no greens)
  const fresh = decideGate(mkFeatures(), ps, STATS0, 0.999)
  assert.equal(fresh.action, "skip") // judgment skip; the ledger row must say so (momentum-2)
  assert.equal(fresh.audit, true)
})

test("classStats: greens decay the audit rate; one red resets it", () => {
  const row = (headSha: string, klass: string) => ({ ts: "t", repo: "r", head: "h", headSha, klass, files: 1, churn: 1, hot: [], ps: null, roster: [], action: "skip", audit: true })
  const rows = [row("1", "code_small"), row("2", "code_small"), row("3", "code_small")]
  const green = new Map([["1", { red: false }], ["2", { red: false }], ["3", { red: false }]])
  assert.equal(classStats(rows, new Map(), "code_small").rate, 1.0) // unlabeled → fresh
  const two = classStats([rows[0], rows[1]], new Map([["1", { red: false }], ["2", { red: false }]]), "code_small")
  assert.equal(two.rate, 1.0) // greens < 3
  const five = classStats([...rows, row("4", "code_small"), row("5", "code_small")], green, "code_small")
  assert.equal(five.greens, 3)
  assert.equal(five.rate, 0.25)
  const red = classStats(rows, new Map([["1", { red: false }], ["2", { red: true }], ["3", { red: false }]]), "code_small")
  assert.equal(red.rate, 1.0) // a red resets the class
})

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// a jev stub: prints the exact `jev run --json` answer shape
function jevStub(dir: string, noul: Record<string, number>): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const [k, v] of Object.entries(noul)) answers[`l_${k}`] = { type: "noul", noul: v }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

test("runGate: jev roster → subset materialization the door accepts; ledger row written", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-gate-run-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const stub = jevStub(tmp, { principles: 0.9, tests: 0.85, momentum: 0.2, questions: 0.3 })
  process.env.WHL_JEV_BIN = stub
  try {
    const { features, decision } = runGate(repo, "main", "feat")
    assert.equal(features.klass, "code_small")
    assert.equal(decision.action, "review")
    assert.deepEqual(decision.roster, ["principles", "tests"])
    const rows = readFileSync(ledgerPath(), "utf8").trim().split("\n")
    assert.equal(rows.length, 1)
    const row = JSON.parse(rows[0])
    assert.equal(row.klass, "code_small")
    assert.equal(row.action, "review")
    assert.deepEqual(row.roster, ["principles", "tests"])
    // the receipt names the class and the roster
    assert.match(gateReceipt(features, decision), /code_small/)
    assert.match(gateReceipt(features, decision), /principles, tests/)
    // materialize with the subset — the door's own screens must accept
    const ready = prepareReview(
      { repo, base: "main", head: "feat", model: "p/m", out: join(tmp, "prog"), roster: decision.roster },
      join(import.meta.dirname, "..", "templates"),
    )
    assert.ok(ready.ok && !ready.skipped, ready.ok ? "" : ready.why)
    const toml = readFileSync(join(ready.ok ? ready.dir : "", "workflow.toml"), "utf8")
    assert.match(toml, /id = "principles"/)
    assert.match(toml, /id = "tests"/)
    assert.doesNotMatch(toml, /id = "momentum"/)
    assert.doesNotMatch(toml, /id = "questions"/)
    const check = prepareRun(ready.ok ? ready.dir : "", { check: true })
    assert.ok(check.ok, check.ok ? "" : check.why)
  } finally {
    delete process.env.WHL_JEV_BIN
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("runGate: jev BROKEN → fail-safe full rail, row still written", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-gate-dead-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const p = join(tmp, "jev-dead.sh")
  writeFileSync(p, "#!/bin/sh\nexit 3\n")
  chmodSync(p, 0o755)
  process.env.WHL_JEV_BIN = p
  try {
    const { decision } = runGate(repo, "main", "feat")
    assert.equal(decision.action, "review")
    assert.deepEqual(decision.roster, [...LENSES])
    assert.equal(decision.ps, null)
  } finally {
    delete process.env.WHL_JEV_BIN
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("runGate: docs-only skips (ledger'd) and never audits — a file-list fact is not a judgment", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-gate-docs-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("checkout -q main")
  writeFileSync(join(repo, "NOTES.md"), "# notes\n")
  g("add -A")
  g("commit -qm docs")
  g("checkout -qb docs-branch")
  writeFileSync(join(repo, "MORE.md"), "# more\n")
  g("add -A")
  g("commit -qm docs2")
  // docs_only is MECHANICAL (gate-r12 momentum-25): the dropout audit
  // samples the JUDGE's skips, and a file-list fact carries no judgment
  // to sample — on a fresh class rate 1.0 audited every docs-only skip
  // and the levy falsified the manual's "docs-only diffs skip at the
  // door" on every first contact. The JUDGMENT is skip, unescalated;
  // the ledger row still records it.
  const { features, decision } = runGate(repo, "main", "docs-branch")
  assert.equal(features.klass, "docs_only")
  assert.equal(decision.action, "skip")
  assert.equal(decision.audit, false)
  assert.match(decision.why, /no judgment to audit/)
})

test("appendLedgerRow: one JSON line per decision", () => {
  const p = join(process.env.AGENTIC_OS_HOME!, "rows.jsonl")
  appendLedgerRow(
    { repo: "r", head: "h", headSha: "a".repeat(40), klass: "test_only", files: 2, churn: 3, hot: [], ps: null, roster: [], action: "skip", audit: false },
    p,
  )
  const lines = readFileSync(p, "utf8").trim().split("\n")
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).klass, "test_only")
})
