import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (verdicts are honest — refusal beats silence, AGENTS.md momentum
// block) — the diff's own law for this verb, written in its own bytes
// (bin/whitehartlane:392-401, gate-r28b momentum-102):
//   "--gate-only's contract is the CALLER's, not the gate's: 'decided +
//    ledger row; the caller levies — never materialize.' One guard, at
//    the caller's seat."
// The guard sits AFTER the WHL_GATE block, so the documented kill-switch
// (bin:351 "WHL_GATE=off is the kill-switch") skips the gate wholesale
// and falls out the bottom of `if (gateOnly) return` — exit 0, empty
// stdout, empty stderr, NO ledger row, NO receipt. A decision-only
// caller (the flag exists so a script can gate its own levy) that runs
// under the kill-switch receives silent SUCCESS for a decision that
// never happened: exit 0 is the answer channel, and here it answers
// nothing while claiming everything went well. The broken-gate twin one
// block up shows the honest shape the same verb already knows:
// "gate: broken (…) — fail-safe: full rail" + exit 1 — a decider that
// decided nothing SAYS so and refuses. A switched-off decider must too.
//
// Deterministic: a main-branch fixture, --gate-only, WHL_GATE=off.
// On BASE (no --gate-only, no gate) the same command reaches
// prepareReview and refuses at the door with exit 2 and a receipt on
// stderr (the shipped template pins temperatures with no --model) —
// refusal beats silence there too. The silence is introduced by this
// diff.
function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "main")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

test("--gate-only under WHL_GATE=off refuses loudly — silence is not a decision", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p102-"))
  const home = join(tmp, "home")
  const ledger = join(home, "gate.jsonl")
  const prog = join(tmp, "prog") // must NOT exist: a decision-only caller levies, never materializes
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = spawnSync(
      process.execPath,
      ["bin/whitehartlane", "review", repo, "--head", "feat", "--gate-only"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, WHL_GATE: "off", AGENTIC_OS_HOME: home, WHL_GATE_LEDGER: ledger, AGENTIC_OS_NOTIFY: "0" },
      },
    )
    const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
    assert.notEqual(
      r.status,
      0,
      `INV-4 (refusal beats silence): "whl review <repo> --gate-only" with WHL_GATE=off exited ${r.status} — ` +
        `silent success. The gate-only guard (bin/whitehartlane:401) sits below the WHL_GATE block, so the ` +
        `kill-switch skips the gate wholesale and the caller's-seat guard returns having decided NOTHING: ` +
        `no ledger row, no receipt, exit 0. The flag's own contract (bin:392, the diff's own bytes) is ` +
        `"decided + ledger row; the caller levies" — a caller that got exit 0 and empty output cannot tell ` +
        `"skip decided" from "nothing decided", and levies nothing while believing the gate answered. ` +
        `The verb's own broken-gate twin (bin:385-389) proves the honest shape it already knows: a decider ` +
        `that decides nothing prints "gate: broken (…) — fail-safe: full rail" and exits 1. A switched-off ` +
        `decider owes the same refusal, not silence. Got status ${r.status}, output: ${JSON.stringify(combined.slice(0, 200))}`,
    )
    assert.match(
      combined,
      /\S/,
      `a decision-only invocation must SAY something (a receipt, a refusal — anything): stdout+stderr were empty. ` +
        `AGENTS.md's momentum block states the repo's own law: "refusal beats silence". ` +
        `Got: ${JSON.stringify(combined)}`,
    )
    assert.equal(
      existsSync(prog),
      false,
      `the caller asked for decision-only: the kill-switch path must never materialize a program either (the materialization fix holds; this finding is the SILENCE around it)`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
