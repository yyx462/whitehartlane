// momentum-1 — the documented csv spelling of review-gate.toml `roster`
// is honored as a ceiling AND reported as voided. INV-4: the receipt
// must name the universe that actually governs.
//
// parseRosterKey (src/doors/review-gate.ts:393) treats a string as the
// CLI csv spelling: valid ids become the ceiling, and the raw string is
// ALWAYS surfaced as rosterUnknown. The door (bin/whitehartlane:418)
// prints that unknown set as "ignored, ALL FOUR lenses are the ceiling".
// Those two sentences cannot both be true.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

test("momentum-1: a valid csv roster string must not be reported as an all-four ceiling (INV-4)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1-"))
  const repo = join(tmp, "repo")
  const home = join(tmp, "home")
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(home, { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  // the spelling the parser's own comment honors (review-gate.ts:386)
  writeFileSync(join(repo, "review-gate.toml"), 'roster = "principles,tests"\nstrictness = "medium"\n')
  writeFileSync(join(repo, "src", "zz.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "zz.ts"), "export const wait = () => false\nexport const n = 1\n")
  g("add -A && git commit -qm feat")
  const stub = join(home, "orch.mjs")
  writeFileSync(stub, "process.exit(0)\n")
  const jev = join(home, "jev.sh")
  writeFileSync(jev, "#!/bin/sh\nexit 1\n")
  chmodSync(jev, 0o755)
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    AGENTIC_OS_NOTIFY: "0",
    AGENTIC_OS_ORCHESTRATOR: stub,
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    WHL_JEV_BIN: jev,
  }
  delete env.WHL_GATE
  delete env.WHL_FROM
  try {
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--gate-only", "--model", "acme/m"],
      { encoding: "utf8", env, cwd: home, timeout: 60_000 },
    )
    const out = `${r.stdout}\n${r.stderr}`
    assert.match(out, /universe: principles,tests/, `the gate must name the csv ceiling it actually applied\n${out}`)
    assert.doesNotMatch(
      out,
      /ALL FOUR lenses are the ceiling/,
      "INV-4: a valid roster = \"principles,tests\" is the ceiling that governs; reporting it as ignored / all-four is a false verdict (bin/whitehartlane review path)",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
