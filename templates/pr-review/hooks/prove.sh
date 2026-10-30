#!/usr/bin/env bash
# prove — the decision model (a gate: the rail ACTS — runs every repro
# and WRITES the verdict; exit 0 means "verdict produced", not "accept").
#
# The law (a fact blocks, an opinion never does): a P0/P1 finding
# blocks the merge ONLY with a repro test that
#   1. loads cleanly and fails on an assertion, on HEAD, TWICE
#      (load error = bogus; pass-then-fail = flaky; passes = refuted),
#   2. classifies against BASE:
#        fails HEAD + passes BASE                     -> introduced    BLOCK
#        fails both + the diff touches the finding's
#        file (the change is implicated)              -> incomplete-fix BLOCK
#        fails both + diff untouched                  -> pre-existing  advisory
# Everything else — unproven, P2, P3 — is advisory and never blocks.
# Gate cap is 300s: at most 12 repros are proven per review, the rest
# degrade to advisory with a receipt (never a silent skip).
set -euo pipefail
prog="$(cd "$(dirname "$0")/.." && pwd)"
. "$prog/data/review/config.sh"
export REPO BASE_SHA HEAD_SHA PROG="$prog"

node <<'EOF'
const { execSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const prog = process.env.PROG
const head = path.join(prog, "data", "review", "head")
const base = path.join(prog, "data", "review", "base")
const die = (why) => { console.error(`prove: ${why}`); process.exit(1) }
if (!fs.existsSync(head) || !fs.existsSync(base)) die("intake checkouts missing — did the intake gate run?")

// file identity is NORMALIZED, never byte-exact (self-review r5
// principles-1/tests-2, both proven: a lens spelling './src/wait.ts'
// or 'src/engines/../doors/x.ts' defeated the diff-implication test
// and flipped a proven bug's verdict to accept)
const normFile = (p) => path.normalize(String(p ?? "").replace(/^\.\//, "")).replace(/^\.\/+/, "")
// the diff-file set for the incomplete-fix classification reads the
// UNFILTERED files-all.txt (gate-r34 tests-10002) — falling back to
// files.txt for program dirs older than that intake (fabricated
// fixtures, pre-existing programs): absent never crashes the gate.
const filesAll = path.join(prog, "data", "review", "files-all.txt")
const filesList = path.join(prog, "data", "review", "files.txt")
const diffFiles = new Set(
  fs
    .readFileSync(fs.existsSync(filesAll) ? filesAll : filesList, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(normFile),
)
const findings = []
for (const unit of fs.readdirSync(path.join(prog, "units"))) {
  const f = path.join(prog, "units", unit, "findings.jsonl")
  if (!fs.existsSync(f)) continue
  for (const [n, line] of fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).entries()) {
    try { findings.push({ ...JSON.parse(line), _unit: unit, _line: n + 1 }) }
    catch { findings.push({ id: `${unit}-malformed-${n + 1}`, lens: unit, severity: "P3", claim: line.slice(0, 120), location: { file: "" }, outcome: "malformed", _unit: unit }) }
  }
}
if (findings.length === 0 && !fs.existsSync(path.join(prog, "units"))) die("no units dir — the lenses stage never ran")

// the wall-clock budget (self-review r2 momentum-1): 12 repros × 3
// runs × any per-run cap can exceed the rail's hard 300s gate, and a
// gate killed mid-prove is an infra failure. Prove ALWAYS finishes:
// past the budget, remaining repros degrade to time-capped advisory
// with receipts — never a silent skip, never a killed gate.
const START = Date.now()
const BUDGET_MS = 240_000
const CHILD_ENV = { ...process.env }
delete CHILD_ENV.NODE_TEST_CONTEXT
// 20s per repro run (self-review r2: 60-90s hangs × 36 runs can never
// fit the gate cap; a hung repro is one degraded finding, not a
// killed gate)
const to = (cmd, cwd) => {
  const timeout = execSync("command -v timeout >/dev/null 2>&1 && echo yes || echo no").toString().trim() === "yes" ? ["timeout", "20"] : []
  try {
    execSync([...timeout, cmd].join(" "), { cwd, env: CHILD_ENV, stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, encoding: "utf8" })
    return { code: 0, err: "", killed: false }
  } catch (e) {
    // killed = signal or cap (timeout/OOM): infra, never an answer
    // (self-review r3 questions-1 — a hung repro used to land as
    // "fail-assert" twice and BLOCK as a verdict)
    return { code: e.status ?? 1, err: `${e.stderr ?? ""}${e.stdout ?? ""}`, killed: e.signal != null || e.status == null || e.status === 124 }
  }
}
// a load error is recognized by SHAPE AND ORDER, never a bare
// string-match (self-review r3 tests-4 — a deterministic repro whose
// ASSERTION MESSAGE quotes a module-error string used to demote to
// bogus and flip the verdict to accept): AssertionError is checked
// FIRST, and a load-error additionally requires that no test passed
const isLoadError = (out) => !/^✔/m.test(out) && /ERR_MODULE_NOT_FOUND|Cannot find (module|package)|SyntaxError|ERR_UNSUPPORTED/.test(out)
const runRepro = (tp, side) => {
  const r = to(`node --test ${JSON.stringify(tp)}`, side)
  if (r.killed) return "killed"
  if (r.code === 0) return "pass"
  if (/AssertionError/.test(r.err)) return "fail-assert"
  if (isLoadError(r.err)) return "load-error"
  // the schema's contract: a blocking repro fails on an ASSERTION — a
  // runtime crash (ReferenceError, OOM-adjacent throws) is a broken
  // repro, not a proven fact
  return "runtime-error"
}

const blocked = [], advisory = [], ledger = [], adopt = []
let proven = 0
const PROVE_CAP = 12
for (const f of findings) {
  const isBlockingSev = f.severity === "P0" || f.severity === "P1"
  if (f.outcome === "malformed") { advisory.push({ ...f, why: "unparseable line — never blocks" }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "malformed" }); continue }
  if (!isBlockingSev) { advisory.push({ ...f, why: `${f.severity}: advisory by severity` }); ledger.push({ ...f, why: `${f.severity}: advisory by severity` }); continue }
  if (!f.repro?.test_path) { advisory.push({ ...f, why: `${f.severity} without repro — unproven` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "unproven" }); continue }
  if (proven >= PROVE_CAP) { advisory.push({ ...f, why: `prove cap (${PROVE_CAP}) reached — degraded, rerun review` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "capped" }); continue }
  const tp = f.repro.test_path
  if (!fs.existsSync(path.join(head, tp))) { advisory.push({ ...f, why: `repro ${tp} does not exist in the HEAD checkout` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "bogus" }); continue }
  // the wall-clock budget: past it, remaining repros degrade with a
  // receipt — the gate must ALWAYS finish inside the rail's 300s cap
  if (Date.now() - START > BUDGET_MS) { advisory.push({ ...f, why: `prove time budget (${BUDGET_MS / 1000}s) spent — degraded, rerun review` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "time-capped" }); continue }
  proven++
  // BOTH HEAD runs happen before any verdict (self-review r2
  // principles-1): a pass-then-fail repro is FLAKY, not refuted —
  // "passes on HEAD" is a claim about every run, not the first
  const h1 = runRepro(tp, head)
  if (h1 === "load-error") { advisory.push({ ...f, why: `repro fails to load on HEAD` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "bogus" }); continue }
  const h2 = runRepro(tp, head)
  if (h1 === "killed" || h2 === "killed") {
    // infra, never an answer (r3 questions-1): a hung or killed repro
    advisory.push({ ...f, why: `repro was KILLED (timeout/signal) on HEAD — infra, never a verdict` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "killed-infra" })
    continue
  }
  if (h1 === "runtime-error" || h2 === "runtime-error") {
    advisory.push({ ...f, why: `repro fails on a non-assertion error — the contract is a failing ASSERTION; fix the repro` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "not-assertion" })
    continue
  }
  if (h1 === "pass" && h2 === "pass") {
    advisory.push({ ...f, why: `repro PASSES on HEAD (both runs) — finding refuted by its own test` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "refuted" })
    // a passing repro is a REGRESSION TEST: it guards the exact behavior
    // the finding worried about and fails the day someone breaks it.
    // Offered for adoption (the author copies it into the repo's own
    // suite — reviewers never write the repo, authors adopt).
    adopt.push({ id: f.id, test_path: tp, kind: "regression", note: "passes on HEAD — adopt into the repo's suite as-is" })
    continue
  }
  if (h1 !== h2) { advisory.push({ ...f, why: `repro is flaky (runs disagree: ${h1} then ${h2})` }); ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "flaky" }); continue }
  // fails on HEAD, twice, on an assertion — now BASE decides the class
  const baseTp = path.join(base, tp)
  fs.mkdirSync(path.dirname(baseTp), { recursive: true })
  fs.copyFileSync(path.join(head, tp), baseTp)
  const b = runRepro(tp, base)
  fs.rmSync(baseTp, { force: true })
  if (b === "load-error") {
    // BASE-side infra is NEVER a verdict (self-review r2 questions-1):
    // a repro that cannot load on BASE (missing module — the degraded
    // install path) says nothing about the change
    advisory.push({ ...f, why: `repro fails to LOAD on BASE — infra, cannot classify; never blocks` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "base-infra" })
  } else if (b === "killed" || b === "runtime-error") {
    advisory.push({ ...f, why: `repro ${b === "killed" ? "was killed" : "crashed on a non-assertion"} on BASE — infra, cannot classify; never blocks` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "base-infra" })
  } else if (b === "pass") {
    blocked.push({ ...f, outcome: "introduced", proof: `repro fails on HEAD (x2), passes on BASE ${process.env.BASE_SHA.slice(0, 8)}` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "introduced" })
    adopt.push({ id: f.id, test_path: tp, kind: "repro", note: "adopt INTO YOUR FIX COMMIT — the test that proves the bug; keep its assertion intact" })
  } else if (diffFiles.has(normFile(f.location?.file))) {
    blocked.push({ ...f, outcome: "incomplete-fix", proof: `repro fails on BASE too AND the diff touches ${f.location.file} — the change is implicated (the twin-path class)` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "incomplete-fix" })
    adopt.push({ id: f.id, test_path: tp, kind: "repro", note: "adopt INTO YOUR FIX COMMIT — the test that proves the bug; keep its assertion intact" })
  } else {
    advisory.push({ ...f, why: `repro fails on BASE too and the diff never touches ${f.location?.file} — pre-existing, file a ticket, do not block` })
    ledger.push({ id: f.id, lens: f.lens, severity: f.severity, outcome: "pre-existing" })
  }
}

const verdict = blocked.length === 0 ? "accept" : "reject"
const out = {
  verdict,
  repo: process.env.REPO,
  base: process.env.BASE_SHA,
  head: process.env.HEAD_SHA,
  blocked: blocked.map(({ _unit, _line, ...f }) => f),
  advisory: advisory.map(({ _unit, _line, why, ...f }) => ({ ...f, why })),
  // the inheritance handover (adopt-on-fix, never write-at-review):
  // every repro that PASSED on HEAD is a regression test to adopt now;
  // every blocking repro is the test to adopt WITH the fix — assertion
  // intact, path per the repo's own conventions
  adopt,
  stats: { findings: findings.length, blocked: blocked.length, advisory: advisory.length, proven },
}
fs.writeFileSync(path.join(prog, "data", "review", "verdict.json"), JSON.stringify(out, null, 2) + "\n")
const lines = ["# advisory — real but never blocking (P2/P3, unproven, pre-existing, bogus, flaky)", ""]
for (const a of advisory) lines.push(`- [${a.severity}] ${a.id} (${a.lens}): ${a.claim} — ${a.why}`)
if (advisory.length === 0) lines.push("- none")
fs.writeFileSync(path.join(prog, "data", "review", "advisory.md"), lines.join("\n") + "\n")
fs.appendFileSync(path.join(prog, "data", "review", "ledger.jsonl"), ledger.map((l) => JSON.stringify({ ts: new Date().toISOString(), head: process.env.HEAD_SHA, ...l })).join("\n") + "\n")
console.log(`prove: ${verdict} — ${blocked.length} blocking (${blocked.map((b) => b.id + ":" + b.outcome).join(", ") || "none"}), ${advisory.length} advisory`)
EOF
