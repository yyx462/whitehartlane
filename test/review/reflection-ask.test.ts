// reflection-ask — the cadence law (the owner's ruling, 2026-11-02):
// "if iterations >= 5 it starts, doing every 3 iterations — to avoid
// overfitting." A mechanism question in EVERY reject would put a
// mechanism change in every push, which is its own overfitting; and
// asking before round 5 interrogates a loop still in good faith.
// The ask fires at rounds 5, 8, 11…, never on an eligible round (the
// banner owns that one), and its answer must change the MECHANISM.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

test("the reflection ask fires per the cadence: silent to round 4, then every third round, never when eligible", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-reflect-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm feat")

    const run = (rounds: number, eligible: boolean) => {
      const dir = join(tmp, `r${rounds}${eligible ? "e" : ""}`)
      mkdirSync(join(dir, "hooks"), { recursive: true })
      mkdirSync(join(dir, "data", "review"), { recursive: true })
      writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(join(ROOT, "templates", "pr-review", "hooks", "merge.sh"), "utf8"))
      writeFileSync(
        join(dir, "data", "review", "config.sh"),
        [
          `REPO='${repo}'`,
          `BASE_BRANCH='main'`,
          `BASE_SHA='${g("rev-parse main").trim()}'`,
          `HEAD_BRANCH='feat'`,
          `HEAD_SHA='${g("rev-parse feat").trim()}'`,
          `TITLE='t'`,
          `MERGE_CMD='true'`,
          "",
        ].join("\n"),
      )
      writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "reject", blocked: [{ id: "x-1", severity: "P1", claim: "c" }] }))
      writeFileSync(join(dir, "data", "review", "stop.json"), JSON.stringify({ rounds, eligible, novel: 2, stuck: [], at: "t" }))
      const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], { cwd: dir, encoding: "utf8", timeout: 60_000 })
      return /REFLECTION ASK/.test(r.stderr)
    }

    assert.ok(!run(4, false), "round 4 is still good faith — silent")
    assert.ok(run(5, false), "round 5 asks (the first cadence beat)")
    assert.ok(!run(6, false), "round 6 is silent — every THIRD round, not every round")
    assert.ok(run(8, false), "round 8 asks (5, 8, 11…)")
    assert.ok(!run(5, true), "an eligible round never asks — the banner owns it")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
