import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests35-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// QUESTIONS.md #5 (break each new call: where does the error land) /
// INV-4 (claims are honest) — the diff's stand-down law
// (src/adapters/rail.ts:285-296, the r23 principles-14 fix: "THIS boot
// stands down unless the record still reads running on disk … `whl
// continue` owns the revival") throws when a runner boots over a
// parked Job — but the throw is raised INSIDE openLedger's outer try
// (rail.ts:247), whose catch (rail.ts:348-359) rethrows ONLY
// LEASE_HELD_BY_LIVE_ORCHESTRATOR and swallows everything else into
// `ledger unavailable (…) — running without a Job record` + return
// null. bin/orchestrator's refusing catch (bin/orchestrator:25-31,
// exit 3, "before a single pane is born") never fires; rail.run()
// (no null-ledger guard, rail.ts:1273) drives the staged program to
// completion UNLEDGERED — this.file's own receipt class (principles-14:
// "an abort booked in the window was stamped and driven to
// completion") is still reachable, minus the stamp: driven to
// completion while the record reads parked. Production path: the
// booking probe orphans a suspended-boot Job A and admits successor B;
// A's runner then boots, "stands down" its ledger, and DRIVES the
// program beside live B — the ghost's end-of-run scope reap is the
// exact j-93d652 retireAll damage the swallowing catch's own comment
// describes. Deterministic: no sleeps, no multiplexer (a gate-only
// program runs its stage command in-process).
test("a boot over a parked Job refuses at the bin — the stand-down is not swallowed into an unledgered drive", () => {
  // BASE shape: the stand-down does not exist yet — nothing to judge
  const railSrc = readFileSync(join(ROOT, "src", "adapters", "rail.ts"), "utf8")
  if (!railSrc.includes("flipped to")) return

  const store = undefined // (imported below via dynamic to honor the env first)
  const home = process.env.AGENTIC_OS_HOME!
  const runDir = mkdtempSync(join(tmpdir(), "whl-t35-run-"))
  let cli: ReturnType<typeof spawnSync> | undefined
  try {
    // the staged program: one gate stage that touches a marker when it
    // is DRIVEN — the observable that separates "refused at the bin"
    // from "drove unledgered"
    writeFileSync(
      join(runDir, "workflow.toml"),
      [
        "[workflow]",
        `name = "t35"`,
        `worker_kind = "opencode"`,
        "",
        "[[stage]]",
        `id = "g"`,
        `topology = "gate"`,
        `run = "bash -c 'touch GHOST_DROVE'"`,
        "",
      ].join("\n"),
    )
    mkdirSync(join(runDir, "data"), { recursive: true })
    writeFileSync(join(runDir, "contract.toml"), `[[contract.deliverables]]\nname = "d"\npath = "result.md"\n`)

    // the parked booking: the door booked it, the drain booked paused,
    // and the runner is only now booting (the mid-boot flip window)
    const job = bookParked(runDir)

    // the runner boots, env-booked, over the parked record — the real
    // runner door, exactly as spawnRunner invokes it
    cli = spawnSync(
      process.execPath,
      [join(ROOT, "bin", "orchestrator"), runDir],
      {
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, AGENTIC_OS_SID: job.sid, AGENTIC_OS_JID: job.id },
      },
    )

    const record = loadRecord(job.sid, job.id)
    assert.equal(
      cli.status,
      3,
      `INV-4 (the boot's honest refusal must land as a refusal — the change's own claim is otherwise false): ` +
        `the stand-down throw (rail.ts:292-296, "the Job flipped to paused during this boot … run: whitehartlane ` +
        `continue") is raised INSIDE openLedger's outer try, whose catch (rail.ts:348-359) rethrows ONLY ` +
        `LEASE_HELD_BY_LIVE_ORCHESTRATOR and swallows the stand-down into "ledger unavailable (…) — running ` +
        `without a Job record" + return null. bin/orchestrator's refusing catch (exit 3, "before a single pane ` +
        `is born") never fires: the boot exited ${String(cli.status)} (stderr: ` +
        `${JSON.stringify((cli.stderr ?? "").trim().split("\n")[0] ?? "")}) and DROVE the parked Job's program ` +
        `to completion unledgered — the stage ran (GHOST_DROVE: ${existsSync(join(runDir, "GHOST_DROVE"))}), ` +
        `the record still reads ${JSON.stringify(record?.state)} with pid ${String(record?.pid)} — a ghost ` +
        `orchestrator worked a program whose receipt says parked, with no lease and no ledger, exactly the ` +
        `principles-14 receipt class ("driven to completion") the stand-down was written to end, and the ` +
        `j-93d652 split-brain the swallowing catch's own comment describes. The stand-down must escape to the ` +
        `bin like the lease refusal does. On BASE the law does not exist (this repro returns early there).`,
    )
    assert.match(
      cli.stderr ?? "",
      /orchestrator: refusing[\s\S]*flipped to paused/,
      "the refusal must reach the bin's stderr — the operator's recovery is the message's own `whitehartlane continue`",
    )
    assert.ok(
      !existsSync(join(runDir, "GHOST_DROVE")),
      "a stood-down boot must not drive a single stage of the parked program",
    )
    assert.equal(record?.state, "paused", "the park receipt stands, unstamped")
    assert.equal(record?.pid, undefined, "no orchestrator pid stamped over a parked record")
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(runDir, { recursive: true, force: true })
  }
})

// the store rides AGENTIC_OS_HOME, set above — import after the env is
// pinned (the repo's own repro convention)
import { createJob, loadJob, openSession, pauseJob, saveJob } from "../../src/adapters/store.ts"

function bookParked(runDir: string): { sid: string; id: string } {
  const session = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "fan-out",
    task: "tests-35 ghost boot",
    runDir: true,
  })
  const rec = loadJob(job.sid, job.id)
  rec!.dir = runDir // the env-booked run stages at the job dir (bin/orchestrator re-derives there)
  saveJob(rec!)
  pauseJob(rec!, "drain", 0)
  return { sid: session.id, id: job.id }
}

function loadRecord(sid: string, jid: string) {
  return loadJob(sid, jid)
}
