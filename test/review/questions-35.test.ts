// questions-35 (questions lens, Q3/Q5) — THE TRUSTED-SIDE CONTRACT
// READER DIES ON AN UNPARSABLE CONTRACT, WHILE ITS TWINS TREAT
// "UNPARSABLE" AS THE DEFAULT.
//
// WHAT THE DIFF CLAIMS (review-gate.toml — a file THIS diff adds):
//
//   # the ship contract for THIS repo — read by `whl review` (the gate's
//   # band) and `gwt submit-pr` (the auto levy). Versioned with the code
//   # it gates; absent/unparsable = medium + no auto levy.
//
// So the contract's own written law is: an unparsable contract means
// the DEFAULT band (medium) — the gate still gates.
//
// THE READER THIS DIFF ADDS (src/doors/review-gate.ts:375-395):
//
//   const commit = opts.base ?? opts.head
//   if (commit) {
//     let raw: string
//     try { raw = execFileSync("git", ["-C", repo, "show", `${commit}:review-gate.toml`], ...) }
//     catch { return { auto: local.auto, model: local.model, strictness: "medium" } }
//     const t = parseToml(raw) as { strictness?: unknown }   // ← NOT guarded
//     ...
//
// The SAME FUNCTION's working-tree reader (lines 365-374) wraps its
// parseToml in try/catch and returns the default. The stop rule's own
// reader (src/doors/stop-rule.ts:100-110) wraps its parseToml in
// try/catch and returns DEFAULT_STOP. Only the trusted-side reader
// throws — the ONE reader whose value the diff routes the BAND through
// (review-gate.ts:468: shipConfigOf(repo, { base: features.baseSha }).strictness).
//
// CONSEQUENCE (verified by running this): the gate DIES with an
// unhandled TomlError. bin/whitehartlane's catch turns that into
// "gate: broken (...) — fail-safe: full rail" — so the door reports
// the gate as broken, no ledger row is written, and the per-project
// band is never consulted. The contract file's own promise
// ("absent/unparsable = medium") is false on the side the diff chose
// to trust.
//
// Q3 (every field the parser accepts reaches a consumer) and Q5 (a
// failure path reports infra as infra, never as an answer): the
// trusted-side read of `strictness` has no consumer at all when the
// document is malformed — the parse failure IS the answer the door
// gets.
//
// The assertion is on runGate (the reader's only caller), so it
// LOADS and PASSES on BASE (BASE has no contract reader at all) and
// FAILS on HEAD — the classification the prove gate wants.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { runGate } from "../../src/doors/review-gate.ts"

test("the trusted-side contract reader treats an unparsable contract as the default band (the contract's own law)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q35-unparsable-"))
  const repo = join(tmp, "repo")
  const prevLedger = process.env.WHL_GATE_LEDGER
  const prevHome = process.env.AGENTIC_OS_HOME
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) =>
      execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    // the BASE branch carries a MALFORMED contract
    writeFileSync(join(repo, "review-gate.toml"), "not toml at all {{{\n")
    g("add", "-A")
    g("commit", "-qm", "malformed contract")
    const base = g("rev-parse", "main").trim()
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const head = g("rev-parse", "HEAD").trim()

    process.env.WHL_GATE_LEDGER = join(tmp, "gate.jsonl")
    process.env.AGENTIC_OS_HOME = tmp

    assert.doesNotThrow(
      () => runGate(repo, base, head, { jev: false }),
      "the gate must not die on an unparsable TRUSTED-side contract — the contract file's own law is 'absent/unparsable = medium + no auto levy'",
    )
  } finally {
    if (prevLedger === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prevLedger
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
