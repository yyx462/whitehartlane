import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m60-home-"))

import { attachPane, listJobs, pauseJob } from "../../src/adapters/store.ts"
import { rebirthRunner } from "../../src/adapters/levy.ts"
import { prepareRun } from "../../src/doors/run.ts"

const ROOT = join(import.meta.dirname, "..", "..")
const FIXTURE = join(ROOT, "test", "fixtures", "three-lookups")

// INV-3 (one decision, one seat — "is there a live writer on this
// program dir?") / INV-4 (the change's own claim): the r25 successor
// veto (levy.ts rebirthRunner) checks the lineage session ONCE, at
// ceremony entry, and then spends up to 30s PER UN-DIED PANE inside
// execFileSync("shep retire") (errors swallowed), before spawnRunner
// books the revival. NOTHING re-checks the session after the check:
// the claim guards in spawnRunner/claimRevivalFlip read only the
// job's OWN record, and the child's boot stand-down (rail.ts) reads
// only its own record too. A booking that lands inside the ceremony
// window — the drain-timeout park with panesRemaining > 0 is the real
// shape that leaves a parked job un-died panes — rides straight into
// TWO live writers on one program dir: exactly the split brain the
// veto's own message says it exists to prevent ("reviving X beside it
// is two live writers; abort the successor first").
//
// The interleave is deterministic, no timers-of-faith: a fake `shep`
// (first PATH hit) writes a marker the moment the retire loop reaches
// it — i.e. AFTER the successor check is provably past — sleeps 5s
// (the veto-free window), and a child process books the successor
// inside that window, on the same lineage session.
test("the successor veto holds across the WHOLE rebirth ceremony, not just at its entry", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "whl-m60-run-"))
  const fakeBin = mkdtempSync(join(tmpdir(), "whl-m60-bin-"))
  const mark = join(scratch, "shep-called")
  const doneMark = join(scratch, "booked.json")
  try {
    // the fake shep: any verb marks + sleeps — the retire call IS the
    // proof the ceremony is past its successor check
    writeFileSync(
      join(fakeBin, "shep"),
      `#!/bin/sh\necho called >> "${mark}"\nsleep 5\nexit 0\n`,
    )
    chmodSync(join(fakeBin, "shep"), 0o755)
    process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`
    process.env.M60_MARK = mark

    // the revival's runner is a fake door (the momentum-50 harness):
    // boots, reports, exits — only the SPAWN matters here
    const door = join(scratch, "door.mjs")
    writeFileSync(door, `process.exit(0)\n`)
    process.env.AGENTIC_OS_ORCHESTRATOR = door

    // a parked job P on the lineage session of the fixture program,
    // with ONE un-died pane — the drain-timeout park shape
    // (panesRemaining > 0, panes never retired). P is booked through
    // the REAL door so it sits on the exact lineage session every
    // booking of this program dir shares.
    const prog = join(scratch, "prog")
    cpSync(FIXTURE, prog, { recursive: true })
    const ready = prepareRun(prog)
    assert.ok(ready.ok, `sanity: the door must book P; got: ${ready.ok ? "" : (ready as { why: string }).why}`)
    if (!ready.ok) return
    const job = (ready as { job: { id: string; sid: string; dir: string; panes: unknown[] } }).job as never as ReturnType<typeof createJob>
    attachPane(job, { label: "w-straggler", pane: "m60-pane" })
    pauseJob(job, "m60: drained past the ceiling with a live pane", 1)

    // the successor books MID-CEREMONY: the child waits for the fake
    // shep's mark (the successor check is past), then books through
    // the same door the operator's spell uses
    const childSrc = join(scratch, "book-child.mjs")
    writeFileSync(
      childSrc,
      [
        `import { existsSync, writeFileSync } from "node:fs"`,
        `import { pathToFileURL } from "node:url"`,
        `const [mark, doneMark, prog, root] = process.argv.slice(2)`,
        `while (!existsSync(mark)) await new Promise((r) => setTimeout(r, 25))`,
        `await new Promise((r) => setTimeout(r, 200))`,
        `const { prepareRun } = await import(pathToFileURL(root + "/src/doors/run.ts").href)`,
        `const r = prepareRun(prog)`,
        `writeFileSync(doneMark, JSON.stringify(r.ok ? { ok: true, id: r.job.id, sid: r.job.sid } : { ok: false, why: r.why }))`,
        `process.exit(0)`,
      ].join("\n"),
    )
    const { spawn } = await import("node:child_process")
    const child = spawn(process.execPath, ["--experimental-strip-types", childSrc, mark, doneMark, prog, ROOT], {
      env: process.env,
      stdio: "ignore",
    }).unref()

    // the ceremony: successor check (child has not booked yet — it
    // waits for the mark) → fake-shep retire blocks 5s (child books
    // inside) → spawnRunner claims + spawns the revival
    const reborn = rebirthRunner(job, ROOT)

    // the child's answer
    let booked: { ok: boolean; id?: string; sid?: string; why?: string } | null = null
    for (let i = 0; i < 400 && !existsSync(doneMark); i++) await new Promise((r) => setTimeout(r, 50))
    if (existsSync(doneMark)) booked = JSON.parse(readFileSync(doneMark, "utf8"))
    assert.ok(booked, "sanity: the mid-ceremony booking attempt returned")
    assert.ok(
      booked!.ok,
      `sanity: the mid-ceremony booking must be ADMITTED for the scenario to exist (a refused booking means the window never opened): ${JSON.stringify(booked)}`,
    )

    assert.ok(
      reborn.ok || /successor booking/.test((reborn as { why?: string }).why ?? ""),
      `sanity: adapted at adoption (gate-r23, the momentum-34 precedent) — the original receipt pinned the DISEASE ` +
        `(the revival proceeding past the entry-only veto). The fix seats the veto AT THE WRITE (spawnRunner, beside ` +
        `the claim), so the revival refuses with the veto's own message when the mid-ceremony booking won; ok=true ` +
        `is only acceptable if the booking lost instead. Got: ${JSON.stringify(reborn).slice(0, 200)}`,
    )

    // THE LAW: one live writer per program dir. After the ceremony the
    // lineage session carries BOTH the revived P (claim flipped it
    // running) and the mid-ceremony successor S (born running,
    // pid-less = a live intent per the canonical oracle bookingStale).
    const sid = (job as unknown as { sid: string }).sid
    const running = listJobs(sid).filter((j) => j.state === "running")
    assert.ok(
      !(reborn.ok && booked!.ok),
      `INV-3/INV-4: the successor veto (levy.ts rebirthRunner, r25 principles-22) checked the session ONCE at ` +
        `ceremony entry, then spent the retire window (${mark ? "5s fake shep" : "?"} per un-died pane, errors ` +
        `swallowed) WITHOUT re-checking — the mid-ceremony booking ${booked!.id} was admitted on this lineage ` +
        `session and the revival ${job.id} was driven to spawn beside it: ${running.length} running Jobs ` +
        `(${running.map((j) => j.id).join(", ")}) on ONE program dir — the exact two-live-writers split brain the ` +
        `veto's own refusal message names ("reviving ${job.id} beside it is two live writers; abort the successor ` +
        `first"). Neither later guard re-reads the session: claimRevivalFlip guards only ${job.id}'s own record, ` +
        `and the child's rail.ts stand-down reads only its own record. The one-writer law needs the check at the ` +
        `WRITE (in spawnRunner, beside the claim), not at the ceremony door.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
    rmSync(fakeBin, { recursive: true, force: true })
  }
})
