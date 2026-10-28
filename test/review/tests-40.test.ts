import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
// ISOLATED MACHINE: HOME points at an empty temp dir (os.homedir()
// reads $HOME per call on POSIX — the probe in principles-7 uses the
// same device), AGENTIC_OS_HOME at the store's sessions root, and NO
// WHL_GATE_LEDGER. This is the ADR 0011 default-layout machine: the
// store's homeRoot() owns "where does whl state live" (store.ts:191,
// with its own TWIN WARNING for exactly this class — r13 tests-3),
// and ~/.local/share/agentic-os does not exist under HOME.
//
// The gate (this diff's new src/doors/review-gate.ts) made that
// decision a THIRD time, diverging from both twins:
//   ledgerPath() = WHL_GATE_LEDGER ?? join(homedir(), ".local",
//   "share", "agentic-os", "review-gate.jsonl")   (review-gate.ts:70)
// Two faults, one root:
//   1. the default path is hard-wired to the LEGACY agentic-os disk —
//      not homeRoot() — so on the whitehartlane default disk (or any
//      AGENTIC_OS_HOME root) the ledger is written OUTSIDE the store
//      the gate itself reads verdict labels from (verdictRedsByHeadSha
//      and hotFileCounts scan sessionsRoot() = homeRoot());
//   2. appendLedgerRow appendFileSync's into a parent directory that
//      nothing ever creates — on a legal machine state (fresh install,
//      default whitehartlane disk, no ~/.local/share/agentic-os)
//      runGate throws ENOENT, the bin's catch demotes the whole gate
//      to "broken — fail-safe: full rail", and the gate — this PR's
//      headline feature — silently never engages on that machine,
//      every receipt claiming "gate: broken" while the ledger the
//      decay loop needs never accumulates.
// The gate's own test suite never sees this: review-gate.test.ts sets
// WHL_GATE_LEDGER to a temp file on every test.
process.env.HOME = mkdtempSync(join(tmpdir(), "whl-t40-home-"))
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-t40-store-"))
process.env.AGENTIC_OS_NOTIFY = "0"
delete process.env.WHL_GATE_LEDGER

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE,
// so the prove gate classifies this repro as introduced, not
// base-infra)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined
const { homeRoot } = await import("../../src/adapters/store.ts")
const ledgerPath = gate?.ledgerPath as (() => string) | undefined
const runGate = gate?.runGate as
  | ((repo: string, base: string, head: string) => { decision: { action: string } })
  | undefined

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  g("init", "-q", "-b", "main")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

test("the gate's ledger lives where homeRoot says state lives (one decision, one place)", () => {
  if (!gate || !ledgerPath) return // BASE: no gate — nothing to judge
  // ── the twin half: one decision ("where does whl state live"),
  // answered by homeRoot() for the store, sessionsRoot() for the
  // gate's own label scans, and a THIRD hard-wired legacy path for
  // the ledger.
  const lp = ledgerPath()
  const root = homeRoot()
  assert.ok(
    lp.startsWith(root),
    `INV-3 (one function per decision): "where does whl state live on disk" is owned by store.ts homeRoot() ` +
      `(store.ts:191 — the file carries a TWIN WARNING because review-trace.mjs once diverged; r13 tests-3), and ` +
      `the gate's own label reader (review-gate.ts verdictRedsByHeadSha/hotFileCounts) scans sessionsRoot() — ` +
      `but this diff's NEW third site, ledgerPath() (review-gate.ts:70), hard-wires ` +
      `~/.local/share/agentic-os/review-gate.jsonl: got ledger path ${lp}, homeRoot() ${root}. The ledger the ` +
      `dropout decay loop reads is written outside the store its verdict labels are read from.`,
  )
})

test("runGate completes its one evaluation — ledger row written — on a legal machine layout", async () => {
  if (!gate || !runGate) return // BASE: no gate — nothing to judge
  // ── the crash half: runGate must complete features → stats → jev →
  // decision → LEDGER ROW (its own contract, review-gate.ts:65 and
  // review-gate.test.ts "ledger row written") on a machine where the
  // hard-wired parent directory does not exist. jev is stubbed dead:
  // the fail-safe full rail is the gate's own documented path for
  // that, and it still ends in appendLedgerRow.
  const tmp = mkdtempSync(join(tmpdir(), "whl-t40-repo-"))
  const lp = ledgerPath() // scoped HERE (the repro read test 1's lp — a scoping bug; the assertion's intent unchanged)
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const jevDead = join(tmp, "jev-dead.sh")
    writeFileSync(jevDead, "#!/bin/sh\nexit 3\n")
    chmodSync(jevDead, 0o755)
    process.env.WHL_JEV_BIN = jevDead
    let decision: { action: string } | undefined
    let threw: unknown
    try {
      const g = runGate(repo, "main", "feat")
      decision = g.decision
    } catch (err) {
      threw = err
    } finally {
      delete process.env.WHL_JEV_BIN
    }
    assert.ok(
      threw === undefined,
      `INV-4 / the gate's own fail-safe contract ("jev unreachable → full rail" must still END in a ledger row): ` +
        `runGate threw on a legal machine layout (HOME=${process.env.HOME} with no ~/.local/share/agentic-os, ` +
        `AGENTIC_OS_HOME=${process.env.AGENTIC_OS_HOME}, WHL_GATE_LEDGER unset): ` +
        `${threw instanceof Error ? `${threw.constructor.name}: ${threw.message.split("\n")[0]}` : String(threw)}. ` +
        `appendLedgerRow (review-gate.ts:136) appendFileSync's into a parent directory nothing creates, so on the ` +
        `default whitehartlane disk (or any AGENTIC_OS_HOME root) the bin's catch demotes the ENTIRE gate to ` +
        `"broken — fail-safe: full rail" on every review: the gate never engages, the receipt lies, and the ` +
        `ledger the greens-decay loop needs never accumulates. The gate's own tests never see this — they all ` +
        `set WHL_GATE_LEDGER.`,
    )
    assert.equal(
      decision?.action,
      "review",
      "sanity: with jev down the decision is the fail-safe full rail",
    )
    // and the row must have LANDED where the twin reads state from
    assert.ok(
      existsSync(lp),
      `the gate's ledger row must exist at ${lp} after runGate — a decision that is not recorded never happened`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(process.env.HOME, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME, { recursive: true, force: true })
  }
})
