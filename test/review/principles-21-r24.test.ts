import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p21-"))

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// INV-3 (twin paths / one writer per job) — the diff's r23 questions-5
// law: "a mate answering this Job's own 'continue or abort it' wake must
// not revive it beside a successor booking the booking probe just
// admitted (two live writers on one lineage session). A live (running,
// non-stale) Job on the same program dir vetoes." (bin/whitehartlane,
// continue verb). The veto's key is `j.dir === job.dir` — but for every
// DOOR booking (prepareRun → createJob runDir:true, no dir) the record's
// dir is the job's OWN run dir, jobRunDir(sid, jid) — unique per jid
// (store.ts:224-226, store.ts:403). Two Jobs of one program NEVER share
// it, so the veto can never fire on the exact path it was written for:
// the stale-orphan wake gets answered, `continue` revives the Job, and
// a second live writer boots beside the successor — the split brain the
// veto exists to prevent, with the change's own claim false.
test("continue vetoes when a live successor booking holds the program (r23 questions-5)", async () => {
  // BASE shape: the canonical oracle this scenario is framed in does not
  // exist yet — nothing to judge
  const storeSrc = readFileSync(join(ROOT, "src", "adapters", "store.ts"), "utf8")
  if (!storeSrc.includes("export function bookingStale")) return

  const { prepareRun } = await import("../../src/doors/run.ts")
  const { bookingStale, listJobs, loadJob, orphanJob } = await import("../../src/adapters/store.ts")

  const prog = mkdtempSync(join(tmpdir(), "whl-p21-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1 — the run that dies and is swept into an orphan wake
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: booking 1 admits; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    const a = listJobs().find((j) => j.state === "running")
    assert.ok(a, "sanity: one running Job booked")
    assert.notEqual(a!.dir, prog, "sanity: the door booking's dir is its run dir, not the program dir")

    // the sweep's ceremony: the dead-run orphan receipt + its wake
    orphanJob(loadJob(a!.sid, a!.id)!, "repro: orchestrator died mid-review", 0)

    // booking 2 — the booking probe admits the successor while the
    // orphan wake is unanswered (the r23 questions-5 shape)
    const second = prepareRun(prog)
    assert.ok(second.ok, `sanity: the successor booking admits; got: ${second.ok ? "" : (second as { why?: string }).why}`)
    const b = listJobs().find((j) => j.id !== a!.id && j.state === "running")
    assert.ok(b, "sanity: the successor is booked and running")
    assert.ok(
      !bookingStale(b!, Date.now()),
      "sanity: the successor is LIVE by the store's own oracle (running, non-stale)",
    )
    assert.notEqual(a!.dir, b!.dir, "sanity: two door bookings of one program hold two DIFFERENT run dirs")

    // a mate answers the stale-orphan wake: `whl continue <A>` — the
    // engine stub keeps the rebirth a harmless no-op process
    const stub = join(process.env.AGENTIC_OS_HOME!, "engine-stub.mjs")
    writeFileSync(stub, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.argv[2], 'engine-started'), 'ok\\n')\n")
    const cli = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "continue", a!.id],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          AGENTIC_OS_HOME: process.env.AGENTIC_OS_HOME!,
          AGENTIC_OS_ORCHESTRATOR: stub,
          SHEP_SCOPE: "whl-test",
        },
      },
    )

    assert.equal(
      cli.status,
      2,
      `INV-3 (one writer per job — the r23 questions-5 veto): the change's own law says "a live (running, ` +
        `non-stale) Job on the same program dir vetoes" a continue — but the veto keys on \`j.dir === job.dir\` ` +
        `(bin/whitehartlane continue verb), and every door booking's dir is its OWN run dir ` +
        `(store.ts:403 createJob runDir:true → jobRunDir(sid, jid), unique per jid at store.ts:224-226), so two ` +
        `Jobs of one program NEVER share it. The veto is dead on the exact path it was written for: ` +
        `\`whl continue ${a!.id}\` (orphan wake unanswered, successor ${b!.id} running and non-stale on the same ` +
        `lineage session) exited ${cli.status} instead of refusing — stderr=${JSON.stringify((cli.stderr ?? "").trim())}, ` +
        `stdout line=${JSON.stringify((cli.stdout ?? "").trim().split("\n")[0] ?? "")}. The rebirth booted a second ` +
        `live writer beside the successor — the split brain the veto exists to prevent; the change's own claim ` +
        `is false. The veto must key on the shared program identity (the lineage session / spur source), not on ` +
        `a field that is unique per booking.`,
    )
    assert.match(
      cli.stderr ?? "",
      /successor/,
      "the refusal must name the successor and its fix (abort the successor or discard this Job)",
    )
    assert.ok(!existsSync(join(a!.dir, "engine-started")), "sanity: no rebirth may have been spawned once the veto lands")
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
