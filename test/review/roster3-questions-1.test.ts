// INV-4: a valid csv roster is a spelling parseRosterKey accepts. It
// keeps the ids as the ceiling AND sets rosterUnknown to the raw
// string. ship-config (bin/whitehartlane ship-config) treats ANY
// rosterUnknown as "ignored, all four lenses run" and never prints the
// ceiling beside it. The printed verdict and the universe disagree.
import assert from "node:assert/strict"
import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { LENSES, shipConfigOf } from "../../src/doors/review-gate.ts"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

test("INV-4: a valid csv roster must not be reported as all-four while the ceiling is a subset", () => {
  const tmp = mkdtempSync(join(tmpdir(), "questions-1-"))
  const repo = join(tmp, "repo")
  execSync("git init -q -b main repo", { cwd: tmp })
  execSync("git config user.email t@t.local && git config user.name t", { cwd: repo })
  writeFileSync(join(repo, "review-gate.toml"), 'roster = "principles,tests"\n')
  execSync("git add -A && git commit -qm base", { cwd: repo })
  try {
    const cfg = shipConfigOf(repo)
    assert.ok(cfg.roster && cfg.roster.length > 0 && cfg.roster.length < LENSES.length, `sanity: csv ceiling parsed, got ${JSON.stringify(cfg.roster)}`)
    const out = execFileSync(process.execPath, ["--experimental-strip-types", BIN, "ship-config", repo], {
      encoding: "utf8",
      env: { ...process.env, AGENTIC_OS_ORCHESTRATOR: join(import.meta.dirname, "..", "orchestrator-stub.mjs") },
    })
    assert.doesNotMatch(
      out,
      /all four lenses run/,
      `INV-4: ship-config reports "all four lenses run" for roster=${JSON.stringify(cfg.roster)} rosterUnknown=${JSON.stringify(cfg.rosterUnknown)} — the printed verdict and the ceiling disagree. got:\n${out}`,
    )
    assert.match(out, /roster: principles,tests/, `INV-4: the ceiling must be the printed answer. got:\n${out}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
