import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the gate's ledger rides the OS-disk trace — pin both at temp disks
// before anything reads them (the repo's own repro convention)
const STORE = mkdtempSync(join(tmpdir(), "whl-t700-store-"))
process.env.AGENTIC_OS_HOME = STORE
process.env.WHL_GATE_LEDGER = join(STORE, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

// INV-4 (the gate's own fail-safe doctrine) — a MID-FAILURE input kills
// the whole gate. readLedger (review-gate.ts:203-210) maps EVERY ledger
// line through JSON.parse with no guard: ONE torn line — a SIGKILL /
// power-loss mid-append, a disk-full partial write, a hand edit — and
// runGate throws before it can decide anything. The bin's catch
// (bin/whitehartlane, the review verb) then demotes the ENTIRE gate:
//   gate: broken (…) — fail-safe: full rail
// on every subsequent review, the dropout ledger stops accumulating
// (rows are only written through runGate), and the gate — this PR's
// headline feature — silently never engages again until a human finds
// and fixes the JSONL by hand. The module already knows this pattern:
// verdictRedsByHeadSha wraps EACH verdict read in try/catch ("skip
// unreadable", review-gate.ts:164-177) and hotFileCounts does too
// (review-gate.ts:100-108) — the ledger reader is the one reader left
// unguarded, and its input is the one store written by appendFileSync
// mid-crash. The ledger's own doctrine is append-only decisions; an
// append-only log whose reader rejects the whole log on one bad line
// converts a torn byte into a permanent feature kill switch.
test("one torn ledger line must not take the whole gate down", () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { appendLedgerRow, runGate } = gate as typeof import("../../src/doors/review-gate.ts")

  const tmp = mkdtempSync(join(tmpdir(), "whl-t700-repo-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "main")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    // a healthy history: one decision already recorded
    appendLedgerRow({
      repo, head: "feat", headSha: "a".repeat(40), klass: "code_small",
      files: 1, churn: 2, hot: [], ps: null, roster: [], action: "review", audit: false,
    })
    assert.equal(
      readFileSync(process.env.WHL_GATE_LEDGER!, "utf8").trim().split("\n").filter(Boolean).length,
      1,
      "sanity: the ledger holds the good row",
    )

    // the mid-failure artifact: a torn append (crash between open and
    // flush — exactly what appendFileSync cannot make atomic across a
    // SIGKILL/power loss)
    appendFileSync(process.env.WHL_GATE_LEDGER!, '{"ts":"2026-01-01T00:00:00.000Z","repo":\n')

    // the next review must still get a decision. Anything else demotes
    // the gate in the bin's catch, permanently.
    let decision: { action: string } | undefined
    let threw: unknown
    try {
      const gRes = runGate(repo, "main", "feat")
      decision = gRes.decision
    } catch (err) {
      threw = err
    }
    assert.ok(
      threw === undefined,
      `INV-4 (fail-safe: uncertainty defaults to reviewing — it must never default to a dead gate): ` +
        `runGate THREW on a ledger holding one good row and one torn line ` +
        `(${threw instanceof Error ? `${threw.constructor.name}: ${threw.message.split("\n")[0]}` : String(threw)}). ` +
        `readLedger (review-gate.ts:203-210) JSON.parses every line unguarded, so one torn append — a SIGKILL ` +
        `mid-write, a disk-full partial line, a hand edit — makes EVERY subsequent runGate throw, and the ` +
        `bin's catch demotes the whole gate: "gate: broken — fail-safe: full rail" on every review, the ` +
        `dropout ledger stops accumulating (rows are written only through runGate), and the gate this PR ` +
        `exists to ship silently never engages again until a human repairs the JSONL by hand. The module ` +
        `already guards its other machine-state readers exactly this way (verdictRedsByHeadSha per-file ` +
        `try/catch at review-gate.ts:164-177, hotFileCounts at :100-108) — the ledger reader is the one ` +
        `reader left open to its own store's mid-failure shape. Skip the unreadable line, decide anyway.`,
    )
    assert.ok(decision, "the gate must return a decision (any decision) past a torn ledger line")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(STORE, { recursive: true, force: true })
  }
})
