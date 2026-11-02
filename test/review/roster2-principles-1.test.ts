// INV-2: a field the parser accepts must reach a consumer — refuse, never vanish.
// review-gate.toml's own claim (the file this diff edits): unknown roster
// ids VOID the key and the door refuses loudly. parseRosterKey only
// surfaces offenders inside an array. A string — the CLI's own spelling,
// roster = "principles,tests" — is accepted by the toml parser and then
// dropped: roster and rosterUnknown both absent, identical to "no
// contract". The fail-safe then fills to all four, so a lens the owner
// excluded runs.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runGate, shipConfigOf } from "../../src/doors/review-gate.ts"

test("INV-2: a non-array roster is refused, not vanished into 'no contract'", () => {
  const tmp = mkdtempSync(join(tmpdir(), "principles-1-"))
  const repo = join(tmp, "repo")
  const prevLedger = process.env.WHL_GATE_LEDGER
  const prevHome = process.env.AGENTIC_OS_HOME
  process.env.WHL_GATE_LEDGER = join(tmp, "ledger.jsonl")
  process.env.AGENTIC_OS_HOME = tmp
  try {
    execSync("git init -q -b main", { cwd: tmp })
    execSync("mkdir -p repo && git init -q -b main repo", { cwd: tmp })
    execSync("git config user.email t@t && git config user.name t", { cwd: repo })
    writeFileSync(join(repo, "src-wait.ts"), "export const wait = () => true\n")
    // the CLI spelling, pasted into the toml key this diff adds
    writeFileSync(join(repo, "review-gate.toml"), 'roster = "principles,tests,questions"\nstrictness = "medium"\n')
    execSync("git add -A && git commit -qm base", { cwd: repo })
    execSync("git checkout -q -b feat", { cwd: repo })
    writeFileSync(join(repo, "src-wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
    execSync("git add -A && git commit -qm feat", { cwd: repo })

    const cfg = shipConfigOf(repo, { base: "main" })
    assert.ok(
      cfg.rosterUnknown && cfg.rosterUnknown.length > 0,
      `INV-2: roster = "principles,tests,questions" is accepted by the toml parser then dropped — roster=${JSON.stringify(cfg.roster)} rosterUnknown=${JSON.stringify(cfg.rosterUnknown)}, indistinguishable from no contract, so the door's loud refusal never fires`,
    )

    // jev down: the fail-safe must fill TO the ceiling the owner wrote,
    // never past it. A vanished string is read as "no ceiling".
    const { decision } = runGate(repo, "main", "feat", { jev: false })
    assert.ok(
      !decision.roster.includes("momentum"),
      `INV-2: fail-safe ran ${JSON.stringify(decision.roster)} — momentum is outside the declared ceiling because the string roster vanished instead of being refused`,
    )
  } finally {
    if (prevLedger === undefined) delete process.env.WHL_GATE_LEDGER
    else process.env.WHL_GATE_LEDGER = prevLedger
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
