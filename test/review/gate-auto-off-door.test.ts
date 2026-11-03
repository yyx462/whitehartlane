// gate-auto-off-door — #275's law, pinned: `auto = false` in the
// TRUNK's committed contract is THE OFF SWITCH — one seat, every door.
// Both 2026-11-03 receipts were a switch off in the human's hands and
// on at the door: a loop agent's DIRECT `whl review` levy ran a full
// 4-lens round over a contract that said false (j-8cf239), and an
// UNMERGED flip read as off while the committed truth said true
// (j-152880). Three switches a human had to know (auto, the door's
// missing refusal, base-vs-worktree read) collapse into one: the
// trunk's committed bytes.
//
// The boundaries pinned here:
//   explicit false on the trunk → the door REFUSES (manual included)
//   --force → the commissioner overrides, on record in the ledger
//   an ABSENT key → no contract: manual reviews fine (the fail-safe
//   direction for an off switch is more review, never less)
//   the PR's own tree cannot switch off its review (base governs)
//   an uncommitted flip never answers (committed truth is the one seat)
//   the refusal is a LEDGER ROW (action "refused" + why), never silence
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { offSwitchDecision } from "../../src/doors/review-gate.ts"

const ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

function fixtureRepo(where: string, trunkToml: string | null, featToml?: string | null) {
  const repo = join(where, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  if (trunkToml !== null) writeFileSync(join(repo, "review-gate.toml"), trunkToml)
  writeFileSync(join(repo, "a.txt"), "a\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "a.txt"), "b\n")
  if (featToml !== undefined && featToml !== null) writeFileSync(join(repo, "review-gate.toml"), featToml)
  g("add", "-A")
  g("commit", "-qm", "feat")
  return repo
}

test("explicit false on the trunk refuses; --force overrides; absent does not", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-off-"))
  try {
    const off = fixtureRepo(tmp, "auto = false\n")
    assert.equal(offSwitchDecision(off, "main", false).refuse, true)
    assert.equal(offSwitchDecision(off, "main", true).refuse, false)

    const none = fixtureRepo(join(tmp, "n"), null)
    assert.equal(offSwitchDecision(none, "main", false).refuse, false)

    const on = fixtureRepo(join(tmp, "y"), "auto = true\n")
    assert.equal(offSwitchDecision(on, "main", false).refuse, false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the PR's own tree cannot switch off its review (the trunk governs)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-off-pr-"))
  try {
    // the trunk says ON, the PR's tree flips it off — the PR must not
    // dodge its own review by rewriting the switch in its own tree
    const repo = fixtureRepo(tmp, "auto = true\n", "auto = false\n")
    assert.equal(offSwitchDecision(repo, "main", false).refuse, false, "a PR tree's false never answers")
    // and the mirror: trunk OFF, PR flips on — still off (the trunk decides)
    const repo2 = fixtureRepo(join(tmp, "b"), "auto = false\n", "auto = true\n")
    assert.equal(offSwitchDecision(repo2, "main", false).refuse, true, "a PR tree's true never un-offs")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("an uncommitted flip never answers — committed truth is the one seat", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-off-dirty-"))
  try {
    const repo = fixtureRepo(tmp, "auto = true\n")
    // the 2026-11-03 morning shape: committed true, working tree false
    writeFileSync(join(repo, "review-gate.toml"), "auto = false\n")
    assert.equal(offSwitchDecision(repo, "main", false).refuse, false, "the door reads the commit, not the editor buffer")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the DOOR refuses the real bin with a ledger row — never silence (j-8cf239's repro)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-off-door-"))
  try {
    const repo = fixtureRepo(tmp, "auto = false\n")
    const ledger = join(tmp, "gate.jsonl")
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "acme/strong"],
      { encoding: "utf8", env: { ...process.env, SHEP_SCOPE: "whl-test", WHL_GATE_LEDGER: ledger }, timeout: 60_000 },
    )
    assert.equal(r.status, 2, `the door must refuse, not levy: ${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /auto = false.*OFF/s)
    assert.match(r.stderr, /--force/)
    // the refusal is a fact in the audit trail: who asked, what the
    // contract said, why no round ran
    const row = JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).at(-1)!)
    assert.equal(row.action, "refused")
    assert.match(row.why, /auto = false/)
    assert.equal(row.repo, repo)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
