// The CLI pin's spelling written into review-gate.toml. A present roster
// value that is not a lens array must cap or be surfaced — never vanish.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { shipConfigOf } from "../../src/doors/review-gate.ts"

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm feat")
  return where
}

test("scalar roster must not vanish (INV-2)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests3-scalar-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    execSync("git checkout -q main", { cwd: repo })
    writeFileSync(join(repo, "review-gate.toml"), 'strictness = "strict"\nroster = "principles,tests,questions"\n')
    execSync("git add -A && git commit -qm roster && git checkout -q feat", { cwd: repo })
    const cfg = shipConfigOf(repo, { base: "main" })
    assert.ok(
      (cfg.rosterUnknown && cfg.rosterUnknown.length > 0) || (cfg.roster && !cfg.roster.includes("momentum")),
      `INV-2: a roster value the owner wrote must either cap or be surfaced as unknown. got roster=${JSON.stringify(cfg.roster)} unknown=${JSON.stringify(cfg.rosterUnknown)} strictness=${cfg.strictness}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
