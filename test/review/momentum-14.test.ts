import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// this repro points AGENTIC_OS_HOME at its own temp disk so no real
// session or ledger is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum14-"))
process.env.WHL_GATE_LEDGER = join(process.env.AGENTIC_OS_HOME, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"

// BASE guard: the gate does not exist on BASE — nothing to loosen, the
// scenario cannot exist there (green by design).
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

// review-gate.ts's own header law: "Fail-safe: … The gate can only
// loosen as greens accumulate; a red in a skipped class re-tightens
// it." And classStats's: "fresh class → audit every skip; greens decay
// the rate; any red resets it."
//
// The loop that would realize that law is deadlocked at birth:
//   - decideGate writes action:"skip" only when roll >= stats.rate, and
//     a fresh class's rate is 1.0 — Math.random() is always < 1.0, so
//     EVERY would-be skip is converted into an audited review first;
//   - an audited skip is recorded with action:"review" (audit:true);
//   - classStats counts greens/reds/audits ONLY from rows with
//     action === "skip" — audited rows feed nothing.
// So no skip row can ever exist → greens can never accumulate → the
// rate can never leave 1.0 → the gate never loosens and the skip region
// the dropout exists to measure never exists. The docs_only branch is
// doubly dead: its audited "review" reaches prepareReview, which
// unconditionally skips docs-only diffs — the ledger says reviewed,
// nothing ran (its own test, "runGate: docs-only skips…", asserts
// action === "review" and so pins the deadlock as desired behavior).
test("the dropout loosens after green measured skips — greens accumulate and the audit rate decays", async () => {
  if (!gate) return // BASE: no gate, scenario cannot exist
  const tmp = mkdtempSync(join(tmpdir(), "whl-m14-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A")
    g("commit -qm base")
    // four one-commit heads so each decision has a distinct headSha to label
    for (let i = 1; i <= 4; i++) {
      g(`checkout -qB feat${i} main`)
      writeFileSync(join(repo, "src", "wait.ts"), `export const wait = () => ${i} > 3\n`)
      g("add -A")
      g(`commit -qm feat${i}`)
    }
    // jev stub: every lens answers "definitely not needed" (noul 0.01)
    const answers: Record<string, { type: string; noul: number }> = {}
    for (const lens of gate.LENSES) answers[`l_${lens}`] = { type: "noul", noul: 0.01 }
    const stub = join(tmp, "jev-stub.sh")
    writeFileSync(stub, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
    chmodSync(stub, 0o755)
    process.env.WHL_JEV_BIN = stub

    const heads: string[] = []
    for (let i = 1; i <= 4; i++) {
      const { features, decision } = gate.runGate(repo, "main", `feat${i}`)
      if (i === 1) {
        // jev said skip on every lens; a fresh class must at least audit.
        // The JUDGMENT is skip and the ESCALATION is the audit flag —
        // the fixed contract (gate-r1 momentum-2: the old shape recorded
        // audited skips as action:"review", making them invisible to
        // classStats, so greens never accrued and the rate never
        // decayed — the gate could never loosen):
        assert.equal(decision.action, "skip", "the fresh class JUDGES skip — the ledger row records the judgment")
        assert.equal(decision.audit, true, "the audit flag marks the measured skip — and the escalation still levies the full rail")
      }
      heads.push(features.headSha)
      // the audited skip came back CLEAN: a green verdict for this head,
      // at the path the gate's own label reader scans
      const vdir = join(
        process.env.AGENTIC_OS_HOME!, "sessions", "s-grad", "jobs", `j-${i}`, "run", "data", "review",
      )
      mkdirSync(vdir, { recursive: true })
      writeFileSync(join(vdir, "verdict.json"), JSON.stringify({ head: features.headSha, blocked: [] }))
    }

    const rows = (readFileSync(process.env.WHL_GATE_LEDGER!, "utf8").trim().split("\n")).map((l) => JSON.parse(l))
    const labels = new Map(heads.map((h) => [h, { red: false }]))
    const stats = gate.classStats(rows, labels, "code_small")
    assert.ok(
      stats.greens >= 3,
      `greens accumulate from audited skips (got ${stats.greens}) — audited rows must feed the class stats`,
    )
    assert.ok(
      stats.rate < 1.0,
      `the audit rate decays below 1.0 after ${stats.greens} green skips (got ${stats.rate}) — "the gate can only loosen as greens accumulate"`,
    )
    assert.ok(
      rows.some((r) => r.action === "skip"),
      "a measured skip lands in the ledger once the class has greens — the skip region exists",
    )
  } finally {
    delete process.env.WHL_JEV_BIN
    rmSync(tmp, { recursive: true, force: true })
  }
})
