import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p22-"))

const { prepareRun } = await import("../../src/doors/run.ts")
const { findSessionByHost, listJobs, loadJob, saveJob } = await import("../../src/adapters/store.ts")

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (one decision, one place — "may this parked Job revive beside a
// live successor booking?") / INV-4 (the record must not lie about who
// leads). This diff's r23/r24 law answers that question for the
// CONTINUE verb — bin/whitehartlane continue:
//
//   const successor = jobs.find(
//     (j) => j.id !== job.id && j.sid === job.sid && j.state === "running" && !bookingStale(j, Date.now()),
//   )
//   if (successor) { ... "the stale-orphan wake is stale too; abort the
//     successor or discard this Job" ... }
//
// — but `continue` is only ONE of the two verbs that revive a parked
// Job through rebirthRunner. The twin verb `refresh` (bin:723) lands on
// the SAME rebirth ceremony — spawnRunner + continueJob, which flips
// the record to running and erases its park receipt — with NO
// successor screen anywhere on its path:
//
//   gate (running + live pid) → SIGTERM → drain → paused →
//   refreshWait(paused) = "continue" → rebirthRunner → running.
//
// The path that breaks (the interleave scripted, no timing): a running
// Job A is asked to refresh; the drain books paused; a successor
// booking B of the SAME program dir is admitted while A reads paused
// (the booking probe skips non-running records; admitAnotherJob counts
// running=0 — both half-laws of this diff working as designed); and
// THEN refresh's rebirth revives A beside live B: two running Jobs for
// one program dir on one lineage session — the split brain
// admitAnotherJob and the r23 veto exist to prevent — and continueJob
// erases A's pause receipt, so the record now lies that A leads. The
// same interleave against `whl continue` refuses with exit 2 (the
// r24 repros pin it) — one decision, two verbs, opposite answers.
// The successor-veto law is this diff's own (r23 questions-5); the
// diff seated it in one verb and left the twin unguarded: the
// incomplete-fix class. (On BASE the veto does not exist anywhere, so
// this repro fails there too — the law is new, its twin is old.)
test("refresh refuses to revive a parked Job while a successor booking is live on the program", async () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-p22-prog-"))
  const home = process.env.AGENTIC_OS_HOME!
  let drainerProc: import("node:child_process").ChildProcess | null = null
  let cli: import("node:child_process").ChildProcess | null = null
  try {
  // the rebirth door is a stub: the veto must fire BEFORE any spawn —
  // if refresh proceeds far enough to spawn, the veto already missed
  const stub = join(home, "engine-stub.mjs")
  writeFileSync(stub, "process.exit(0)\n")
  // the stand-in orchestrator: a live pid that, on refresh's SIGTERM,
  // books the drain (paused) — the exact record state refreshWait
  // continues on. Plain fs: the record is job.json on the OS disk.
  const drainer = join(home, "drainer.mjs")
  writeFileSync(
    drainer,
    [
      `import { readFileSync, writeFileSync } from "node:fs"`,
      `import { join } from "node:path"`,
      `const home = process.env.WHL_P22_HOME`,
      `const record = join(home, "sessions", process.env.WHL_P22_SID, "jobs", process.env.WHL_P22_JID, "job.json")`,
      `writeFileSync(process.env.WHL_P22_READY, "ok")`,
      `process.on("SIGTERM", () => {`,
      // a deliberate 300ms drain before the paused write: refresh's
      // FIRST poll load must observe running and ENTER its 500ms wait;
      // the flip then lands inside that tick, so the successor books
      // before refresh's rebirth can observe it (the scripted
      // interleave, no timing — the repro's own header contract)
      `  setTimeout(() => {`,
      `    const j = JSON.parse(readFileSync(record, "utf8"))`,
      `    j.state = "paused"`,
      `    j.pause = { reason: "drain", panesRemaining: 0, at: new Date().toISOString() }`,
      `    writeFileSync(record, JSON.stringify(j))`,
      `    process.exit(0)`,
      `  }, 300)`,
      `})`,
      `setInterval(() => {}, 1 << 30)`,
    ].join("\n"),
  )

  // ── booking 1: job A, running, with a live orchestrator pid (the
  // drainer stands in for the real runner)
  cpSync(FIXTURE, prog, { recursive: true })
  const first = prepareRun(prog)
  assert.ok(
    first.ok,
    `sanity: booking 1 must admit; got: ${first.ok ? "" : (first as { why?: string }).why}`,
  )
  if (!first.ok) return
  const jobA = (first as { job: { id: string; sid: string } }).job
  const session = findSessionByHost("whitehartlane", resolve(prog))
  assert.ok(session, "sanity: the lineage session exists")

  const ready = join(home, "drainer-ready")
  const drainerEnv = {
    ...process.env,
    WHL_P22_HOME: home,
    WHL_P22_SID: jobA.sid,
    WHL_P22_JID: jobA.id,
    WHL_P22_READY: ready,
  }
  drainerProc = spawn(process.execPath, ["--experimental-strip-types", drainer], {
    env: drainerEnv,
    stdio: "ignore",
  })
  const readySeen = await (async () => {
    for (let i = 0; i < 100 && !existsSync(ready); i++) {
      await new Promise((r) => setTimeout(r, 50)) // ceiling only — the observed wait is the ready file
    }
    return existsSync(ready)
  })()
  assert.ok(readySeen, "sanity: the drainer booted and installed its SIGTERM handler")
  const a = loadJob(jobA.sid, jobA.id)!
  a.pid = drainerProc.pid!
  saveJob(a)

  // ── the refresh: its gate (running + live pid) passes, it SIGTERMs
  // the drainer and polls the record for the parked state
  cli = spawn(
    process.execPath,
    ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "refresh", jobA.id],
    {
      cwd: ROOT,
      env: { ...process.env, AGENTIC_OS_HOME: home, AGENTIC_OS_ORCHESTRATOR: stub },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stderr = ""
  cli.stderr?.on("data", (d) => (stderr += String(d)))

  // the drain books paused 300ms after the SIGTERM (the drainer's
  // deliberate delay above) — observed on the RECORD (not the exit
  // event), so the successor books the moment the park lands, well
  // inside refresh's 500ms poll tick
  await (async () => {
    for (let i = 0; i < 400 && loadJob(jobA.sid, jobA.id)?.state !== "paused"; i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
  })()
  assert.equal(
    loadJob(jobA.sid, jobA.id)?.state,
    "paused",
    "sanity: the drain booked paused — the state refreshWait continues on",
  )

  // ── the successor booking: the door's own law admits B while A reads
  // paused (the probe skips non-running records; running=0). This is
  // the exact shape the r23 veto names: a live successor on the
  // program dir when the parked Job's revival lands.
  const second = prepareRun(prog)
  assert.ok(
    second.ok,
    `sanity: the successor booking admits while A is parked; got: ${second.ok ? "" : (second as { why?: string }).why}`,
  )
  const successor = listJobs(session!.id).find((j) => j.id !== jobA.id && j.state === "running")
  assert.ok(successor, "sanity: successor B is live on the same lineage session")

  // ── refresh's poll observes paused and performs the rebirth. Under
  // THE FIXED verb the r23 veto refuses here (exit 2, naming the
  // successor, before any spawn) — the same answer `whl continue`
  // gives on this exact store.
  let exitCeiling: NodeJS.Timeout | undefined
  const exitCode = await Promise.race([
    new Promise<number | null>((res) => cli.once("exit", (c) => res(c))),
    new Promise<null>((res) => (exitCeiling = setTimeout(() => res(null), 60_000))), // ceiling — the observed wait is the exit event
  ])
  clearTimeout(exitCeiling)

  const running = listJobs(session!.id).filter((j) => j.state === "running")
  const aNow = loadJob(jobA.sid, jobA.id)
  assert.equal(
    exitCode,
    2,
    `INV-3/INV-4: "may this parked Job revive beside a live successor booking?" is decided by this diff's own ` +
      `r23/r24 successor veto — but the veto is seated in the CONTINUE verb only. The twin revival verb refresh ` +
      `(bin/whitehartlane:723) lands on the SAME rebirthRunner ceremony with no successor screen: on this store ` +
      `(successor ${successor?.id} running and non-stale on lineage session ${jobA.sid}, parked ${jobA.id} paused) ` +
      `refresh exited ${String(exitCode)} (stderr: ${JSON.stringify(stderr.trim().split("\n")[0] ?? "")}) instead of ` +
      `refusing with "a successor booking ... is live" — and continueJob flipped A back to running beside B. ` +
      `Running records now: [${running.map((j) => `${j.id} (pid ${j.pid})`).join(", ")}] for ONE program dir on ONE ` +
      `lineage session — the split brain admitAnotherJob and the r23 veto exist to prevent. One decision, two ` +
      `verbs, opposite answers: \`whl continue ${jobA.id}\` on this exact store refuses with exit 2 (the r24 ` +
      `repro pins it); \`whl refresh ${jobA.id}\` drove the same rebirth anyway. The veto must sit on the shared ` +
      `rebirth ceremony (or in refresh, its twin), not in one caller.`,
  )
  assert.match(
    stderr,
    /successor/,
    "the refusal must name the successor and its fix (abort the successor or discard this Job)",
  )
  // and the record must keep the park receipt until a LEGAL revival —
  // the revived record erased its pause receipt (INV-4: the record lies)
  assert.equal(
    aNow?.state,
    "paused",
    `INV-4: the parked record must keep its receipt — after the un-vetoed refresh it read ` +
      `${JSON.stringify(aNow?.state)} with the pause receipt ${aNow?.pause ? "present" : "erased"} ` +
      `(continueJob reset it beside successor ${successor?.id}): the record lies about who leads`,
  )

  // cleanup: the drainer is dead (SIGTERM); whatever the rebirth stub
  // booked is dead (exit 0 stub); drop the temp store and program
  } finally {
    try {
      if (drainerProc?.exitCode === null && drainerProc?.pid) process.kill(drainerProc.pid, "SIGKILL")
    } catch { /* already gone */ }
    try {
      if (cli?.exitCode === null && cli?.pid) process.kill(cli.pid!, "SIGKILL")
    } catch { /* already gone */ }
    rmSync(join(home, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
