import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the gate's ledger + label scan ride the OS-disk trace — pin both at
// temp disks before anything reads them (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-t103-home-"))
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-t103-store-"))
process.env.HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"
const LEDGER = join(HOME, "gate-ledger.jsonl")
process.env.WHL_GATE_LEDGER = LEDGER

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE,
// so the prove gate classifies this repro as introduced)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

function fixtureRepo(where: string): string {
  mkdirSync(where, { recursive: true })
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(where, "README.md"), "base docs\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "README.md"), "feat docs\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

test("the gate's label for a re-run head is the NEWEST verdict, not the lexicographically-last dir", async () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { runGate, appendLedgerRow } = gate as typeof import("../../src/doors/review-gate.ts")

  const tmp = mkdtempSync(join(tmpdir(), "whl-t103-repo-"))
  const realRandom = Math.random
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const H = execFileSync("git", ["-C", repo, "rev-parse", "feat^{commit}"], { encoding: "utf8" }).trim()

    // the class's ledger history: three greens' worth of skip rows for
    // THIS head — enough that a GREEN label decays the rate to 0.25
    for (let i = 0; i < 3; i++) {
      appendLedgerRow({
        repo,
        head: "feat",
        headSha: H,
        klass: "docs_only",
        files: 1,
        churn: 2,
        hot: [],
        ps: null,
        roster: [],
        action: "skip",
        audit: false,
      })
    }

    // two verdicts for the SAME headSha — the re-run shape: run 1
    // REJECTED the head (red, written first), the operator re-levied
    // and run 2 ACCEPTED it (green, written later, newer mtime).
    // Run 1 lives in a job dir that sorts LAST; run 2 in one that
    // sorts FIRST — the label must follow RECENCY, never readdir order.
    const red = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-zzzz", "jobs", "j-zzzz", "run", "data", "review")
    const green = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-aaaa", "jobs", "j-aaaa", "run", "data", "review")
    mkdirSync(red, { recursive: true })
    mkdirSync(green, { recursive: true })
    writeFileSync(join(red, "verdict.json"), JSON.stringify({ verdict: "reject", head: H, blocked: [{ id: "old-1", location: { file: "docs/old.md" } }] }))
    writeFileSync(join(green, "verdict.json"), JSON.stringify({ verdict: "accept", head: H, blocked: [] }))
    const older = new Date(Date.now() - 60_000)
    utimesSync(join(red, "verdict.json"), older, older) // red is the OLDER run
    utimesSync(join(green, "verdict.json"), new Date(), new Date()) // green is the re-run

    // the decision must see the GREEN (newest) label: greens=3, reds=0
    // → rate decays to 0.25 → roll 0.9 ≥ 0.25 → a plain audited-no skip.
    // (roll patched so the decision discriminates: rate 1.0 always
    // audits, 0.25 does not.)
    Math.random = () => 0.9
    let decision: { action: string; audit: boolean; reds: number; greens: number; auditRate: number }
    try {
      const g = runGate(repo, "master", "feat")
      decision = g.decision
    } finally {
      Math.random = realRandom
    }

    assert.equal(
      decision.reds,
      0,
      `INV-4 (labels are facts where they live — the gate reads the verdict for a re-run head): ` +
        `two verdicts exist for headSha ${H.slice(0, 8)} — a RED written by the FIRST run (job dir s-zzzz/j-zzzz, ` +
        `mtime older) and a GREEN written by the re-run (job dir s-aaaa/j-aaaa, mtime newer). ` +
        `verdictRedsByHeadSha's own comment says "one verdict per headSha: LAST one wins (re-runs of the same head)" ` +
        `— but "last" is readdirSync enumeration order (name-sorted), not recency: the lexicographically-LAST ` +
        `dir's stale RED won, so the gate counted reds=${decision.reds} (greens=${decision.greens}, ` +
        `auditRate=${decision.auditRate}). With the red label stuck, rate pins at 1.0 — every docs-only skip ` +
        `audits forever, and the decay loop ("greens decay the rate; the gate loosens as greens accumulate") ` +
        `is dead on every head that was ever rejected once and re-run — the manual's own re-levy loop.`,
    )
    assert.equal(
      decision.audit,
      false,
      `the decayed class must not audit this skip (rate 0.25, roll 0.9): the stale red label forced ` +
        `rate=1.0 → audit=${decision.audit} — the gate can never loosen past its first rejected re-run`,
    )
    assert.equal(decision.action, "skip", "sanity: a docs-only diff still skips (audited or not)")
  } finally {
    Math.random = realRandom
    rmSync(tmp, { recursive: true, force: true })
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(HOME, { recursive: true, force: true })
  }
})
