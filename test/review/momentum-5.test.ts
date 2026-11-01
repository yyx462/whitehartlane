import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { stageRun } from "../../src/doors/run.ts"
import { checkpoint, readState } from "../../src/core/state.ts"

// the unit ledger rides the OS-disk trace — point AGENTIC_OS_HOME at
// this repro's own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum5-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (the change's own claim): the manual's hard rule — bin
// whitehartlane:327 "never materialize a fresh program to retry",
// ECONOMICS.md:71 "Re-levy, never re-materialize", SKILL.md:210 "never a
// fresh materialization" — describes re-materializing as the wasteful
// path that "re-runs every lens". The fold makes an identical-args
// re-materialization behave EXACTLY like a re-levy: the fresh program
// is identity-identical (same template, same model pin, same
// data/review/config.sh), so staging it folds the prior review's done
// lenses and a `whl review` re-run replays the old verdict with zero
// fresh minds. The documented distinction no longer exists.
test("an identical-args re-materialization does not silently replay a completed review's lenses", () => {
  const repo = mkdtempSync(join(tmpdir(), "whl-m5-repo-"))
  const outRoot = mkdtempSync(join(tmpdir(), "whl-m5-out-"))
  try {
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    mkdirSync(join(repo, "src"), { recursive: true })
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    const args = { repo, base: "master", head: "feat", model: "zhipuai-coding-plan/glm-5.3-flash" }
    const p1 = prepareReview({ ...args, out: join(outRoot, "program-1") }, join(ROOT, "templates"))
    assert.ok(p1.ok && !("skipped" in p1 && p1.skipped), "sanity: first materialization")
    const r1 = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-m5", "jobs", "j-m5", "run")
    stageRun(p1.ok ? p1.dir : "", r1)

    // run 1 completes: the four lenses settle done with their findings
    for (const lens of ["principles", "tests", "momentum", "questions"]) {
      mkdirSync(join(r1, "units", lens), { recursive: true })
      writeFileSync(join(r1, "units", lens, "findings.jsonl"), "")
      checkpoint(r1, `unit:${lens}`, "ok", "run 1 settled", lens)
    }
    assert.ok(
      readState(r1).done.includes("principles"),
      "sanity: run 1's lenses settled done",
    )

    // the identical command, again — a FRESH materialization, the thing
    // the manual says re-runs every lens
    const p2 = prepareReview({ ...args, out: join(outRoot, "program-2") }, join(ROOT, "templates"))
    assert.ok(p2.ok && !("skipped" in p2 && p2.skipped), "sanity: second materialization")
    const r2 = mkdtempSync(join(tmpdir(), "whl-m5-run2-"))
    stageRun(p2.ok ? p2.dir : "", r2)

    assert.ok(
      !readState(r2).done.includes("principles"),
      `INV-4: the manual promises a fresh materialization re-runs every lens (bin:327, ` +
        `ECONOMICS.md:71, SKILL.md:210), but the fold's identity matches the prior review ` +
        `byte-for-byte (same workflow pin, same data/review/config.sh), so the "fresh" ` +
        `re-run replayed run 1's done lenses: r2 ledger done=${JSON.stringify(readState(r2).done)} — ` +
        `zero fresh minds, a new job and verdict.json over old findings, and no doc site ` +
        `tells the operator the law's two paths are now the same path`,
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(outRoot, { recursive: true, force: true })
  }
})
