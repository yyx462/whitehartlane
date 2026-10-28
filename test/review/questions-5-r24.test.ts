import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-questions5-"))

const { prepareRun } = await import("../../src/doors/run.ts")
const { listJobs, loadJob, saveJob } = await import("../../src/adapters/store.ts")

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

// QUESTIONS.md #1/#6 — the r23 questions-5 guard (bin/whitehartlane,
// the continue verb: "a mate answering this Job's own 'continue or
// abort it' wake must not revive it beside a successor booking the
// booking probe just admitted … A live (running, non-stale) Job on
// the same program dir vetoes") compares `j.dir === job.dir`. Each
// booking mints its OWN run dir (store.ts createJob: `dir: input.dir ??
// (input.runDir ? jobRunDir(sid, id) : "")`), so a successor booking of
// the SAME program dir carries a DIFFERENT dir and the veto can never
// fire on the path its own comment names. The store's one-writer
// doctrine ("one writer per job, always", store.ts pidAlive) is then
// defeated end to end: the stale-orphan wake is answered, rebirthRunner
// finds no live lease on the ORPHANED job, and a second live
// orchestrator boots beside the successor on one lineage session.
test("continue refuses while a live successor booking owns the same program dir", () => {
  const prog = mkdtempSync(join(tmpdir(), "whl-q5-prog-"))
  try {
    cpSync(FIXTURE, prog, { recursive: true })

    // booking 1 → job A. The run dies mid-flight; the record sits
    // running and pid-less. TIME PASSES (2× the booking grace, no
    // sleeps — the same no-timing device momentum-8-r15 uses).
    const first = prepareRun(prog)
    assert.ok(first.ok, `sanity: booking 1 admits; got: ${first.ok ? "" : (first as { why?: string }).why}`)
    const [a0] = listJobs()
    assert.ok(a0, "sanity: booking 1 is on the store")
    const a = loadJob(a0!.sid, a0!.id)!
    a.created = new Date(Date.now() - 30 * 60_000).toISOString()
    saveJob(a)

    // booking 2: the re-levy of the SAME program dir — the booking
    // probe orphans A (stale, pid-less) and admits B.
    const second = prepareRun(prog)
    if (!second.ok) return // BASE shape: the running>0 veto held — this class cannot exist there
    const after = listJobs(a.sid)
    const aNow = loadJob(a.sid, a.id)!
    assert.equal(aNow.state, "orphaned", "sanity (HEAD): the probe orphaned the stale booking A")
    const b = after.find((j) => j.id !== a.id && j.state === "running")
    assert.ok(b, "sanity (HEAD): a successor booking B is running on the same lineage session")
    assert.equal(b!.spur?.source, a.spur?.source, "sanity: B books the SAME program dir as A")
    assert.notEqual(b!.dir, a.dir, "sanity: each booking stages its own run dir — the veto's j.dir === job.dir can never match it")

    // the stale-orphan wake, answered: `whl continue A`. The r23
    // questions-5 guard must veto (a live successor owns the program).
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "continue", a.id],
      { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
    )
    assert.equal(
      r.status,
      2,
      `INV-4 / the store's one-writer doctrine (store.ts pidAlive: "one writer per job, always"): the continue ` +
        `verb's successor veto compares j.dir === job.dir, but every booking mints its own run dir ` +
        `(store.ts createJob → jobRunDir(sid, id)), so the live successor B (${b!.id}, dir ${b!.dir}) never matches ` +
        `orphaned A (${a.id}, dir ${a.dir}) on the same program dir (${String(a.spur?.source)}) — the veto cannot fire ` +
        `on the path its own comment names ("a successor booking the booking probe just admitted"): ` +
        `continue exited ${r.status} (${String((r.stdout ?? "").trim().split("\n")[0] ?? "")}) and rebirthRunner found ` +
        `no live lease on A, booting a second live writer beside B on one lineage session. ` +
        `stderr: ${String(r.stderr ?? "").trim().split("\n").slice(0, 2).join(" | ")}`,
    )
    assert.match(
      String(r.stderr ?? ""),
      /successor booking/,
      "the refusal must name the successor (the prescribed fix: abort the successor or discard this Job)",
    )
  } finally {
    // the continue (on HEAD) may have spawned a real reborn runner —
    // kill whatever pid it booked, then drop the temp store
    try {
      const [a0] = listJobs()
      if (a0) {
        const a = loadJob(a0.sid, a0.id)
        if (a?.pid) process.kill(a.pid, "SIGKILL")
      }
    } catch { /* already gone */ }
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(prog, { recursive: true, force: true })
  }
})
