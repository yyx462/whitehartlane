import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the gate's ledger rides the OS-disk trace — pin it at a temp disk
// before anything reads it (the repo's own repro convention)
const STORE = mkdtempSync(join(tmpdir(), "whl-t9601-store-"))
process.env.AGENTIC_OS_HOME = STORE
process.env.WHL_GATE_LEDGER = join(STORE, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

// INV-4 (the facts the script supplies are honest) — review-gate.ts's
// own division of labor: "the script supplies FACTS … the class's audit
// history from the ledger. jev supplies the JUDGMENT." The ledger's own
// fact for "was this skip escalated to a measured full-rail audit?" is
// the row's `audit` column (decideGate writes it; the receipt prints
// "DROPOUT AUDIT"; the bin says "a dropout audit self-levies"). But
// classStats (review-gate.ts:197-198) counts `audits += 1` for EVERY
// skip row — the `audit` flag is read by nothing — so the plain skips
// (the majority once a class decays: rate 0.25 leaves 3 of 4 skips
// unescalated) enter the "audit history" as audits. The corrupted fact
// rides the judgment seam verbatim (review-gate.ts:255,
// class_audit_history.audits → the jev state the four noul are answered
// from): after 100 skips on a decayed class the judge reads "audits:
// 100, greens: 25" where the honest fact is "audits: 25, greens: 25" —
// the script's fact about its own measurement is wrong, on the one
// input the judgment is told to answer from ("Answer from the diff's
// class, size, files, and audit history").
//
// Deterministic, pure: one audited green skip + three plain skips; the
// decay math itself is sound (pinned too, so the fix cannot regress it).
test("classStats' audits counts the ESCALATED skips (the row's own audit flag), never the plain skips", () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { classStats, jevLenses } = gate as typeof import("../../src/doors/review-gate.ts")
  try {
    // ── the class's history: 1 audited skip (escalated → the rail ran →
    // its verdict.json labels it green) + 3 plain skips (no rail, and no
    // verdict will ever exist for them — they are NOT measurements)
    const row = (headSha: string, audit: boolean) => ({
      ts: "2026-01-01T00:00:00.000Z", repo: "r", head: "h", headSha, klass: "code_small" as const,
      files: 1, churn: 1, hot: [], ps: null, roster: [], action: "skip" as const, audit,
    })
    const rows = [row("green-1", true), row("plain-1", false), row("plain-2", false), row("plain-3", false)]
    const labels = new Map([["green-1", { red: false }]])

    const stats = classStats(rows, labels, "code_small")

    // premise: the decay math is exactly as documented (this finding is
    // about the audits counter alone)
    assert.equal(stats.greens, 1, "premise: the one labeled green registers")
    assert.equal(stats.reds, 0, "premise: no reds")
    assert.equal(stats.rate, 1.0, "premise: greens < 3 — the class is still fresh (decay untouched by this finding)")

    assert.equal(
      stats.audits,
      1,
      `INV-4 (the script supplies FACTS — review-gate.ts's own header law): classStats (review-gate.ts:197-198) ` +
        `counts \`audits += 1\` for EVERY skip row — the ledger's own \`audit\` column, the one fact that says ` +
        `whether the skip was escalated to a measured full-rail audit, is read by nothing. The class here holds ` +
        `ONE audit (green-1, escalated, labeled by its verdict.json) and THREE plain skips (jev said skip, the ` +
        `roll said stand down — no rail ran, no verdict will ever exist for them, they are not measurements of ` +
        `anything), and stats.audits came back ${stats.audits}. On a decayed class (rate 0.25) three of every ` +
        `four skips are unescalated, so the inflation is unbounded: after 100 skips the judge is told "audits: ` +
        `100, greens: 25" where the honest fact is "audits: 25, greens: 25" — the script's fact about its own ` +
        `audit history is wrong, count the audit flag in the row (or rename the fact to what it counts).`,
    )

    // ── the corrupt fact reaches the judgment seam verbatim (INV-2: the
    // fact has a consumer — the jev state the four noul are answered from)
    const stub = join(STORE, "jev-cap.sh")
    const capture = join(STORE, "state-captured.json")
    const answers = ["principles", "tests", "momentum", "questions"]
      .map((l) => `"l_${l}":{"type":"noul","noul":0.5}`)
      .join(",")
    writeFileSync(stub, `#!/bin/sh\ncp "$5" "${capture}"\necho '{"answers":{${answers}}}'\n`)
    chmodSync(stub, 0o755)
    process.env.WHL_JEV_BIN = stub
    let state: { class_audit_history?: { audits?: number } } | undefined
    try {
      jevLenses(
        {
          repo: "/tmp/r", base: "main", head: "feat", baseSha: "a".repeat(40), headSha: "b".repeat(40),
          files: ["src/a.ts"], churn: 10, klass: "code_small", hotFiles: [],
        },
        stats,
      )
      state = JSON.parse(readFileSync(capture, "utf8"))
    } finally {
      delete process.env.WHL_JEV_BIN
    }
    assert.equal(
      state?.class_audit_history?.audits,
      1,
      `INV-2/INV-4: the inflated counter rides the judgment seam verbatim — jevLenses (review-gate.ts:255) feeds ` +
        `class_audit_history.audits = ${JSON.stringify(state?.class_audit_history?.audits)} into the state the ` +
        `judge answers from ("Answer from the diff's class, size, files, and audit history"). The gate's one ` +
        `judgment is calibrated on a fact the gate itself miscounts: 4 skips reached the state as 4 audits where ` +
        `the ledger's own audit column says 1. The fact must be repaired at the source (classStats), not here.`,
    )
  } finally {
    rmSync(STORE, { recursive: true, force: true })
  }
})
