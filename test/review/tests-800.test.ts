import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-3 (one function per decision) — "which base does the review judge
// when --base is absent?" is answered by TWO sites after this change:
//   bin/whitehartlane:354   `const baseRef = val("base") ?? "master"` — master ONLY
//   src/doors/review.ts:344 the door auto-detects ["master", "main", "trunk"]
// On any repo whose trunk is `main` — the git/GitHub default; no master
// exists — the gate's very first git call (rev-parse master^{commit})
// throws inside runGate, the bin demotes it ("gate: broken — fail-safe:
// full rail"), and because gateFeatures throws BEFORE appendLedgerRow,
// NO ledger row is written either. The review gate — this diff's whole
// feature — silently NEVER engages on main-only repos: no roster, no
// dropout, no class history, ever, while stderr's one-time "gate:
// broken" reads like a transient and no receipt ever says why.
// Secondary break, same path: --gate-only's contract is "decided +
// ledger row; the caller levies" (the bin's own comment), but the
// early return lives INSIDE the try — the throw falls through to
// prepareReview, so a --gate-only caller gets a full program
// MATERIALIZED despite asking for decision-only (and any --unattended
// caller gets the rail levied with no gate decision at all).
// Deterministic: a main-only fixture, no --base, jev absent (the
// fail-safe full-rail judgment), the plain spell.
function mainOnlyRepo(where: string): string {
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

test("the review gate engages on a main-only repo with no --base, and --gate-only does not materialize", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-tests800-"))
  const home = join(tmp, "home")
  const ledger = join(home, "gate.jsonl")
  const prog = join(tmp, "prog") // must NOT exist: --gate-only decides, the caller levies
  try {
    const repo = mainOnlyRepo(join(tmp, "repo"))
    const r = spawnSync(
      process.execPath,
      ["bin/whitehartlane", "review", repo, "--head", "feat", "--gate-only", "--model", "acme/strong", "--out", prog],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, AGENTIC_OS_HOME: home, WHL_GATE_LEDGER: ledger, AGENTIC_OS_NOTIFY: "0" },
      },
    )
    const combined = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
    assert.equal(
      /gate: broken/.test(combined),
      false,
      `INV-3 (one decision — "the default base" — answered two opposite ways): the gate never engages on a ` +
        `main-only repo. bin/whitehartlane:354 hardcodes the gate's default to \`val("base") ?? "master"\` while ` +
        `the door it fronts auto-detects ["master", "main", "trunk"] (src/doors/review.ts:344) — on the git/GitHub ` +
        `default branch layout (main, no master) runGate's first git call throws, the bin prints ` +
        `"gate: broken — fail-safe: full rail", and NO ledger row is written (gateFeatures throws before ` +
        `appendLedgerRow), so this diff's whole feature — roster, dropout, class history — silently never runs ` +
        `on main-only repos. Got stderr/stdout: ${combined.split("\n").filter((l) => l.includes("gate:")).join(" | ")}`,
    )
    assert.match(
      combined,
      /^gate: (review|skip) — class /m,
      `the gate must print a real decision receipt (it engaged and judged), not the broken demotion`,
    )
    assert.ok(
      existsSync(ledger),
      `the gate's decision must be ledger'd (the dropout's sample) — on a main-only repo no row is ever written`,
    )
    assert.equal(
      existsSync(prog),
      false,
      `--gate-only means "decided + ledger row; the caller levies" (the bin's own comment), but the early return ` +
        `sits inside the try: on the broken-gate path the throw falls through to prepareReview and a full program ` +
        `was materialized at ${prog} — the caller asked for a decision, the door built a rail`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
