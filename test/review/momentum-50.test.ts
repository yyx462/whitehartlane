import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m50-home-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(ROOT, "test", "fixtures", "three-lookups")

// BASE shape guard (the repo's own device): the stand-down law is this
// diff's own addition — on BASE there is no window to lose and the
// whole scenario is vacuous-green (the prove gate classifies introduced)
const HEAD_HAS_STAND_DOWN = readFileSync(join(ROOT, "src", "adapters", "rail.ts"), "utf8").includes("STAND_DOWN")

import { openSession, createJob, saveJob, pauseJob, continueJob, loadJob } from "../../src/adapters/store.ts"
import { spawnRunner } from "../../src/adapters/levy.ts"
import { stageRun } from "../../src/doors/run.ts"

// local liveness probe (pidAlive is exported only on HEAD — importing it
// statically would fail to LOAD on BASE and misclassify this repro)
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

test("a revival's own runner survives rebirthRunner's spawn→flip order — the stand-down must not kill the boot its parent has not flipped yet", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "whl-m50-run-"))
  try {
    // the staged program the runner door boots against (the repo's own
    // rehearsal fixture), and a PARKED Job on it — the exact record
    // `whl continue` / `whl refresh` hand to a fresh runner
    const prog = join(scratch, "prog")
    cpSync(FIXTURE, prog, { recursive: true })
    const runDir = join(scratch, "run")
    stageRun(prog, runDir)
    const sess = openSession({ cwd: prog })
    const job = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "m50", dir: runDir })
    saveJob(job)
    pauseJob(job, "m50 fixture — a parked run", 0) // state:"paused", persisted

    // the runner door: replicates bin/orchestrator's boot shape exactly
    // (constructs the Rail with the env-booked sid/jid that spawnRunner
    // passes), and REPORTS the boot's outcome before exiting
    const mark = join(scratch, "boot")
    writeFileSync(
      join(scratch, "door.mjs"),
      [
        `import { writeFileSync } from "node:fs"`,
        `import { pathToFileURL } from "node:url"`,
        `const { Rail } = await import(pathToFileURL(${JSON.stringify(join(ROOT, "src", "adapters", "rail.ts"))}).href)`,
        `let outcome = "booted"`,
        `try { new Rail({ argvDir: process.argv[2], workflow: "fan-out", programRoots: [] }) }`,
        `catch (e) { outcome = String(e?.message ?? e).startsWith("STAND_DOWN") ? "stand-down" : "refused" }`,
        `writeFileSync(${JSON.stringify(mark)}, outcome)`,
      ].join("\n"),
    )
    process.env.AGENTIC_OS_ORCHESTRATOR = join(scratch, "door.mjs")

    // rebirthRunner's order, piece by piece (levy.ts:94-95):
    //   const out = spawnRunner(job, ...) ; if (out.ok) continueJob(job, out.pid)
    // The child boots CONCURRENTLY; nothing orders continueJob's
    // running-flip before the child's own record read. This repro forces
    // the legal-but-unlucky interleave deterministically — the child's
    // boot completes BEFORE the parent's flip lands, which is exactly
    // what a slow/loaded parent (or a fast child) produces in production.
    const out = spawnRunner(job, ROOT)
    assert.ok(out.ok, `sanity: the runner spawned: ${JSON.stringify(out)}`)

    let outcome = "?"
    for (let i = 0; i < 200 && !existsSync(mark); i++) await new Promise((r) => setTimeout(r, 100))
    assert.ok(existsSync(mark), "sanity: the door reported its boot outcome")
    outcome = readFileSync(mark, "utf8")

    // the parent's tail of the ceremony — in production this runs
    // immediately after spawnRunner returns; here it runs after the
    // child has booted (the losing schedule, deterministic)
    continueJob(job, out.pid)

    assert.ok(
      outcome !== "stand-down",
      `INV-4 / lifecycle: the revival's own runner was refused STAND_DOWN at birth. rebirthRunner ` +
        `(src/adapters/levy.ts:94-95) spawns the runner BEFORE continueJob flips the parked record to ` +
        `running, and the child's boot enforces the stand-down law (src/adapters/rail.ts openLedger: ` +
        `"fresh.state !== 'running'" throws) — whenever the child's record read lands inside that window ` +
        `(a loaded machine, a slow parent fs write, a descheduled 'whl continue'), the revival kills its ` +
        `own runner. The operator's spell silently fails while the door prints success.`,
    )

    if (outcome === "stand-down") {
      // the aftermath receipt, claimed only when the bug actually fired
      const rec = loadJob(sess.id, job.id)!
      assert.ok(
        !(rec.state === "running" && !alive(rec.pid!)),
        `INV-4: after the stood-down boot, continueJob still flipped the record to running naming the ` +
          `dead child's pid (${rec.pid}) — a false liveness receipt on disk until the sweep orphans it. ` +
          `The revival was killed AND the record claims it lives.`,
      )
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

// silence the unused-guard lint for BASE runs (HEAD_HAS_STAND_DOWN is
// documentation; the scenario is honest on both trees because BASE has
// no stand-down law to lose to)
void HEAD_HAS_STAND_DOWN
