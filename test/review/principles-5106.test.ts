// principles-5106 — the band's TRUSTED side crashes on an unparsable
// contract, while its twin (the working-tree side, and the stop rule's
// own reader) treats "unparsable" as the default band.
//
// THE CHANGE'S OWN CONTRACT (review-gate.toml, added by THIS diff):
//
//   # the ship contract for THIS repo — read by `whl review` (the gate's
//   # band) and `gwt submit-pr` (the auto levy). Versioned with the code
//   # it gates; absent/unparsable = medium + no auto levy.
//
// THE TRUSTED-SIDE READER (src/doors/review-gate.ts:375-395, added by
// this diff):
//
//   const commit = opts.base ?? opts.head
//   if (commit) {
//     let raw: string
//     try { raw = execFileSync("git", ["-C", repo, "show", `${commit}:review-gate.toml`], ...) }
//     catch { return { auto: local.auto, model: local.model, strictness: "medium" } }
//     const t = parseToml(raw) as { strictness?: unknown }   // ← NOT guarded
//     ...
//
// The WORKING-TREE reader (the same function, `local`, lines 365-374)
// wraps its parseToml in try/catch, and the stop rule's own reader
// (src/doors/stop-rule.ts:100-110) wraps its parseToml in try/catch.
// Only the base-commit reader throws: a base branch carrying a
// malformed review-gate.toml makes the GATE die with an unhandled
// TomlError instead of gating at the default band.
//
// Consequences: the gate never runs (no lenses, no verdict), and the
// door's crash is not an honest refusal — the PR is silently
// unreviewed while the operator sees a stack trace.
//
// INV-3 (one decision, one place — three readers, one of them
// divergent) + the change's own written contract.
//
// The assertion is on runGate (the reader's only caller), so it LOADS
// and PASSES on BASE (BASE has no contract reader at all) and FAILS on
// HEAD — the classification the prove gate wants.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { runGate } from "../../src/doors/review-gate.ts"

test("the gate survives an unparsable contract on the trusted side (the default band)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-band-unparsable-"))
  const repo = join(tmp, "repo")
  const prevLedger = process.env.WHL_GATE_LEDGER
  const prevHome = process.env.AGENTIC_OS_HOME
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    // the BASE branch carries a malformed contract
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
      "the gate must not die on an unparsable base contract — it must gate at the default band ('absent/unparsable = medium')",
    )
  } finally {
    if (prevLedger === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prevLedger
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
