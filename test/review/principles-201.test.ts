import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-p201-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BIN = join(ROOT, "bin", "whitehartlane")

// BASE shape guard (the momentum-14 device): bookingStale — the canonical
// stale-booking oracle whose LEASE arm this finding is about — is this
// diff's own addition. On BASE there is no oracle and no lease-arm law;
// vacuous green there by construction.
const HAS_ORACLE = readFileSync(join(ROOT, "src", "adapters", "store.ts"), "utf8").includes(
  "export function bookingStale",
)

if (!HAS_ORACLE) {
  test("principles-201: BASE — no stale-booking oracle, nothing to judge", () => {})
} else {
  const { createJob, listJobs, loadJob, liveLeaseHolder, openSession, pidAlive, bookingStale, saveJob } =
    await import("../../src/adapters/store.ts")

  // INV-3 (one decision, one answer) / INV-4 (the record must not lie).
  //
  // "Is this running Job's orchestrator actually live — may a writer act
  // on it?" is answered by THE stale-booking oracle this diff wrote
  // (store.ts bookingStale): the record's pid half alone never decides —
  // "A lease whose holder is alive and not expired is the repo's own
  // answer that this Job is NOT abandoned" (the momentum-41 residue:
  // record.pid holds the lease's LOSER while the lease crowns a live
  // winner). The sweep, the doctor, the audit verb, the booking probe
  // (run.ts) and the revival veto (levy.ts) all route through it — and
  // rebirthRunner refuses at its door on liveLeaseHolder ("one writer
  // per job"). The ABORT verb one file over still answers with the raw
  // record.pid half (bin/whitehartlane:1164): pidAlive false → it skips
  // the SIGKILL + pane-retire + pkill ceremony (the ghost-worker
  // guarantee: "anything holding this job's dir dies with the job") and
  // books abortJob on the record BESIDE the live holder. abortJob is a
  // blind write: the live orchestrator's next save clobbers the abort
  // receipt — the split-brain the lease mutex exists to prevent
  // (j-93d652 gap #2) — and the record now claims "declined by user"
  // while the holder the record itself names keeps driving.
  //
  // The shape is not exotic: it is the exact residue bookingStale's lease
  // arm was written for (momentum-41), and this diff's own boot reorder
  // (acquireLease BEFORE the pid stamp, rail.ts) mints a
  // lease-live/pid-stale window on every orchestrator boot.
  //
  // Remedy-neutral law: after `whl abort`, either the Job still reads
  // running (the verb refused, naming the live holder like the rebirth
  // door does), or the holder the record names is DEAD (the verb killed
  // it before booking). An abort receipt beside a LIVE holder is the
  // finding.
  test("abort does not book beside a live lease holder its own oracle counts live", async () => {
    // a REAL live holder: a long-lived node child
    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    // a PROVEN-dead pid for the record's stale half
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"])
    try {
      const session = openSession({ cwd: HOME })
      const job = createJob({
        sid: session.id,
        stoodUpBy: "standalone",
        workflow: "fan-out",
        task: "principles-201 lease-live abort",
        runDir: true,
      })
      // the residue shape: record.pid = the dead loser, the lease crowns
      // the live winner (momentum-41's own words)
      const rec = loadJob(session.id, job.id)!
      rec.state = "running"
      rec.pid = dead.pid!
      rec.lease = {
        holder: `orchestrator pid=${holder.pid}`,
        epoch: 1,
        renewed: new Date().toISOString(),
        expires: new Date(Date.now() + 120_000).toISOString(),
      }
      saveJob(rec)

      // premise: THE canonical oracle counts this Job live — and the
      // record's pid half alone calls it dead
      const fresh = loadJob(session.id, job.id)!
      assert.equal(
        bookingStale(fresh, Date.now()),
        false,
        "premise: bookingStale — the one stale-booking oracle — counts this Job NOT abandoned (live lease holder)",
      )
      assert.ok(
        liveLeaseHolder(fresh) !== null,
        "premise: liveLeaseHolder answers a live holder — the same law that refuses the rebirth door",
      )
      assert.equal(pidAlive(fresh.pid!), false, "premise: the record's pid half is a proven-dead pid")

      const r = spawnSync(
        process.execPath,
        ["--experimental-strip-types", BIN, "abort", job.id],
        {
          cwd: ROOT,
          encoding: "utf8",
          // no children but node: the abort verb's `shep status` probe and
          // any wake transport are not the world under judgment (the
          // momentum-80 convention) — and never hang on a real multiplexer
          env: { AGENTIC_OS_HOME: HOME, AGENTIC_OS_NOTIFY: "0", PATH: "" },
        },
      )

      const holderStillAlive = holder.pid ? pidAlive(holder.pid) : false
      const after = loadJob(session.id, job.id)!
      assert.ok(
        !(after.state === "aborted" && holderStillAlive),
        `INV-3/INV-4: "is this running Job's orchestrator live?" is answered by THE stale-booking oracle ` +
          `(store.ts bookingStale: "A lease whose holder is alive and not expired is the repo's own answer that ` +
          `this Job is NOT abandoned" — the momentum-41 residue arm this diff wrote), and every writer routes ` +
          `through it but the abort verb: bin/whitehartlane:1164 decides on the raw record.pid half ` +
          `(\`job.state === "running" && pidAlive(job.pid)\`), so with record.pid dead and the lease crowning a ` +
          `LIVE holder it skipped the SIGKILL + pane-retire + pkill ceremony (the ghost-worker guarantee: ` +
          `"anything holding this job's dir dies with the job") and booked abortJob on the record BESIDE the ` +
          `live holder — abortJob is a blind write, so the holder's next save clobbers the abort receipt ` +
          `(the split-brain the lease mutex exists to prevent, j-93d652 gap #2). After \`whl abort\`: ` +
          `record state=${after.state} (receipt ${JSON.stringify(after.abort ?? null)}) while the holder the ` +
          `record itself names is still alive (pid ${holder.pid}, alive=${String(holderStillAlive)}); ` +
          `bookingStale=${String(bookingStale(after, Date.now()))}, liveLeaseHolder=${JSON.stringify(liveLeaseHolder(after))}, ` +
          `cli rc=${String(r.status)} stdout=${JSON.stringify((r.stdout ?? "").trim())}. The rebirth door refuses ` +
          `exactly this record ("a live orchestrator holds … one writer per job"); the abort verb must answer the ` +
          `same oracle — refuse naming the holder, or kill the holder it names before booking. Never an abort ` +
          `receipt beside a live writer.`,
      )
    } finally {
      holder.kill(9)
      rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    }
  })
}
