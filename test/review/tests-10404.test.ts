// tests-10404 (tests lens) — THE TRUSTED-SIDE CONTRACT READER CRASHES
// ON AN UNPARSABLE CONTRACT: THE GATE DIES INSTEAD OF GATING AT THE
// DEFAULT BAND ITS OWN WRITTEN CONTRACT PROMISES.
//
// WHAT THE CHANGE CLAIMS (review-gate.toml, the file THIS diff adds):
//
//   # the ship contract for THIS repo — read by `whl review` (the gate's
//   # band) and `gwt submit-pr` (the auto levy). Versioned with the code
//   # it gates; absent/unparsable = medium + no auto levy.
//
// and the diff's own test (test/review-gate.test.ts):
//
//   // unknown band and garbage toml → medium, never vanish
//   writeFileSync(join(repo, "review-gate.toml"), "not toml at all {{{\n")
//   assert.equal(shipConfigOf(repo).strictness, "medium")
//
// THE READERS (src/doors/review-gate.ts, shipConfigOf — added by THIS
// diff):
//
//   const local = (() => {
//     const p = join(repo, "review-gate.toml")
//     if (!existsSync(p)) return { auto: false, model: undefined }
//     try {
//       const t = parseToml(readFileSync(p, "utf8")) as { auto?: unknown; model?: unknown }
//       return { auto: t.auto === true, model: typeof t.model === "string" ? t.model : undefined }
//     } catch {                                            // ← GUARDED
//       return { auto: false, model: undefined }
//     }
//   })()
//   ...
//   if (commit) {
//     let raw: string
//     try { raw = execFileSync("git", ["-C", repo, "show", `${commit}:review-gate.toml`], ...) }
//     catch { return { auto: local.auto, model: local.model, strictness: "medium" } }
//     const t = parseToml(raw) as { strictness?: unknown }   // ← NOT GUARDED
//     ...
//   }
//
// The WORKING-TREE reader is guarded, the stop rule's own reader
// (src/doors/stop-rule.ts, also added by this diff) is guarded — only
// the TRUSTED-SIDE reader throws. smol-toml's parse() throws a
// TomlError on an unparsable document ("not toml at all {{{" →
// "illegal character in key").
//
// CONSEQUENCE: a base branch carrying a malformed review-gate.toml makes
// runGate throw. The door's catch demotes it ("gate: broken — fail-safe:
// full rail") — so the gate NEVER ENGAGES for that repo: no band, no
// ledger row, no dropout measurement, and an operator-facing stack
// trace for a merely-malformed contract. The written contract says
// "absent/unparsable = medium + no auto levy".
//
// INV-3 (one decision — "what band is this repo?" — one place: three
// readers, one divergent) + the change's own written contract.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { runGate } from "../../src/doors/review-gate.ts"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

const fixture = (tmp: string) => {
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
  // the BASE branch carries a malformed contract
  writeFileSync(join(repo, "review-gate.toml"), "not toml at all {{{\n")
  g("add -A && git commit -qm 'malformed contract'")
  const base = g("rev-parse main").trim()
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
  g("add -A && git commit -qm feat")
  const head = g("rev-parse HEAD").trim()
  return { repo, base, head }
}

test("the gate survives an unparsable contract on the TRUSTED side (the default band)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-band-unparsable-"))
  const prevLedger = process.env.WHL_GATE_LEDGER
  const prevHome = process.env.AGENTIC_OS_HOME
  try {
    const { repo, base, head } = fixture(tmp)
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

test("the door's gate still engages on an unparsable base contract (a ledger row, no 'gate: broken')", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-band-unparsable-door-"))
  const ledger = join(tmp, "gate.jsonl")
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: tmp,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: ledger,
    WHL_JEV_BIN: join(tmp, "jev-dead"),
  }
  writeFileSync(env.WHL_JEV_BIN, "#!/bin/sh\nexit 1\n")
  try {
    const { repo } = fixture(tmp)
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", join(tmp, "out")],
      { env, encoding: "utf8", timeout: 60_000 },
    )
    assert.ok(!/gate: broken/.test(r.stderr), `an unparsable contract must not break the gate: ${r.stderr}`)
    const rows = readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean)
    assert.equal(rows.length, 1, `the gate must still write its ledger row (the default band): ${r.stdout}\n${r.stderr}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
