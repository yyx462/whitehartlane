import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// MOMENTUM (a decision the caller asked for becomes an act) / INV-4 —
// --gate-only's contract is written at both of its guard sites in
// bin/whitehartlane: "decided + ledger row; the caller levies", and the
// broken-gate arm refuses to materialize for exactly this reason
// ("the caller asked for a DECISION, not a rail", gate-r14). But BOTH
// guards live INSIDE `if (process.env.WHL_GATE !== "off")` — the gate
// block itself. Under the documented kill-switch (the bin's own words:
// "WHL_GATE=off is the kill-switch (legacy full-rail behavior)") the
// whole block is skipped, --gate-only is never consulted, and the bin
// falls straight through to prepareReview: the decision-only caller
// gets a full program MATERIALIZED at --out — and, with --unattended
// or --from, a full rail LEVIED. The rollback switch silently turns
// every --gate-only automation seam into a rail builder: the exact
// "asked for a decision, got a rail" shape the flag's own broken-gate
// arm refuses, one switch earlier. The flag is this diff's own
// addition (BASE has no gate and no --gate-only), so the contract
// violation is introduced, not inherited.
test("--gate-only materializes nothing, even with the gate killed off", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-m102-"))
  const home = join(tmp, "home")
  const prog = join(tmp, "program") // must NOT exist: --gate-only decides, the caller levies
  try {
    const repo = join(tmp, "repo")
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    mkdirSync(join(repo, "src"), { recursive: true })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 0\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(ROOT, "bin", "whitehartlane"),
        "review",
        repo,
        "--head",
        "feat",
        "--model",
        "acme/strong",
        "--gate-only",
        "--out",
        prog,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, AGENTIC_OS_HOME: home, WHL_GATE: "off", AGENTIC_OS_NOTIFY: "0" },
      },
    )
    assert.equal(
      existsSync(prog),
      false,
      `INV-4 (the caller's receipt must match the act): --gate-only means "decided + ledger row; the caller ` +
        `levies" (bin/whitehartlane's own comment at both guard sites), and the broken-gate arm refuses to ` +
        `materialize for exactly this reason (gate-r14: "the caller asked for a DECISION, not a rail"). ` +
        `Under WHL_GATE=off — the bin's own documented kill-switch — both guards are skipped with the gate ` +
        `block they live in, and the bin fell through to prepareReview: the program was MATERIALIZED at ` +
        `${prog} (exists=${String(existsSync(prog))}, rc=${String(r.status)}, stderr head=` +
        `${JSON.stringify((r.stderr ?? "").split("\\n")[0] ?? "")}). A decision-only caller under the rollback ` +
        `switch silently built the rail's program — the exact "asked for a decision, got a rail" shape the ` +
        `flag's own gate-r14 guard refuses. Honor --gate-only OUTSIDE the WHL_GATE block: decided means ` +
        `decided, whoever made the decision.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
