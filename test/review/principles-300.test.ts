import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-p300-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BIN = join(ROOT, "bin", "whitehartlane")

// BASE shape guard (the momentum-14 device): bookingStale — the canonical
// stale-booking oracle whose lease arm this finding turns on — is this
// diff's own addition. On BASE there is no oracle and no residue law;
// vacuous green there by construction.
const HAS_ORACLE = readFileSync(join(ROOT, "src", "adapters", "store.ts"), "utf8").includes(
  "export function bookingStale",
)

if (!HAS_ORACLE) {
  test("principles-300: BASE — no stale-booking oracle, nothing to judge", () => {})
} else {
  const { bookingStale, createJob, liveLeaseHolder, loadJob, openSession, pidAlive, saveJob } =
    await import("../../src/adapters/store.ts")

  // INV-3 (one decision, one answer) / INV-4 (the receipt must be a fact).
  //
  // "Is this running Job's orchestrator actually live?" is answered by THE
  // stale-booking oracle this diff wrote (store.ts bookingStale: "A lease
  // whose holder is alive and not expired is the repo's own answer that
  // this Job is NOT abandoned" — the momentum-41 residue arm). This diff
  // migrated FOUR of the six sites that make the decision to the oracle —
  // the sweep, the doctor, the audit verb, the booking probe, and (gate-r30
  // principles-201) the abort verb, whose own receipt on the residue shape
  // now says "held by a live orchestrator (…) — kill or pause it first".
  // The two REMAINING sites — the pause verb (bin/whitehartlane:820) and
  // the refresh verb (bin:760) — still decide on the raw record.pid half
  // (`job.state !== "running" || !pidAlive(job.pid)`). On the exact
  // residue shape the oracle was written for (record.pid holds the lease's
  // LOSER, dead; the lease crowns a LIVE winner), those two verbs answer
  // the opposite of the canonical oracle: "(orchestrator not live)" —
  // while abort, moments earlier on the SAME store, named the live holder
  // and prescribed "pause it first". One decision, two opposite answers —
  // and abort's own prescribed recovery dead-ends at the pause verb's
  // refusal (the incomplete-fix class: the drain-path-fixed/stop-path-
  // forgotten shape this repo's REVIEWER.md names the most common bug).
  //
  // Remedy-neutral law: on a store the canonical oracle counts live-held,
  // no verb may report the orchestrator "not live" — pause/refresh must
  // consult the same oracle abort now consults (refuse naming the holder,
  // or act on the holder it names).
  test("pause and refresh answer the canonical liveness oracle, never the raced pid half", async () => {
    // a REAL live holder: a long-lived node child
    const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    })
    // a PROVEN-dead pid for the record's raced half
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"])
    try {
      const session = openSession({ cwd: HOME })
      const job = createJob({
        sid: session.id,
        stoodUpBy: "standalone",
        workflow: "fan-out",
        task: "principles-300 twin verbs",
        runDir: true,
      })
      // the residue shape (momentum-41's own words): record.pid = the
      // lease's dead LOSER; the lease crowns the LIVE winner
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

      // premise: THE canonical oracle counts this Job live-held
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

      const env = { AGENTIC_OS_HOME: HOME, AGENTIC_OS_NOTIFY: "0", PATH: "" }
      const run = (verb: string) =>
        spawnSync(process.execPath, ["--experimental-strip-types", BIN, verb, job.id], {
          cwd: ROOT,
          encoding: "utf8",
          env,
        })

      // premise (the r30 law, green at HEAD): abort consults the oracle
      // and refuses NAMING the live holder — the store is really in the
      // residue shape, and abort's receipt really prescribes "pause it first"
      const ab = run("abort")
      assert.equal(
        ab.status,
        2,
        `premise: abort refuses a live-held Job with exit 2 (gate-r30 principles-201); got rc=${String(ab.status)} stdout=${JSON.stringify((ab.stdout ?? "").trim())} stderr=${JSON.stringify((ab.stderr ?? "").trim())}`,
      )
      assert.match(
        ab.stderr ?? "",
        /held by a live orchestrator/,
        "premise: abort's refusal names the live holder — the canonical oracle's answer on this store",
      )
      assert.equal(
        loadJob(session.id, job.id)!.state,
        "running",
        "premise: the refusal booked nothing — the record still reads running",
      )

      // THE LAW: pause answers the SAME oracle. It must not report a
      // live-held Job as "(orchestrator not live)" — a fact the store's
      // own oracle contradicts and abort named on the same store one verb
      // earlier (and whose prescribed recovery, "pause it first", this
      // refusal then dead-ends).
      const pa = run("pause")
      assert.doesNotMatch(
        pa.stderr ?? "",
        /orchestrator not live/,
        `INV-3/INV-4: "is this running Job's orchestrator live?" is answered by THE stale-booking oracle ` +
          `(store.ts bookingStale, whose lease arm this diff wrote: "A lease whose holder is alive and not expired ` +
          `is the repo's own answer that this Job is NOT abandoned"). This diff migrated the sweep, the doctor, ` +
          `the audit verb, the booking probe and the abort verb to that oracle — and on THIS store abort just ` +
          `refused with "held by a live orchestrator (…) — kill or pause it first". The pause verb ` +
          `(bin/whitehartlane:820) still decides on the raw record.pid half (\`!pidAlive(job.pid)\`): on the ` +
          `residue shape (record.pid = the lease's dead loser, the lease crowning a live winner) it answered ` +
          `"pause: ${job.id} is running (orchestrator not live) — only a running Job can pause" with rc=${String(pa.status)} ` +
          `(stderr: ${JSON.stringify((pa.stderr ?? "").trim())}) — the opposite fact about the same store, from the ` +
          `same CLI, one verb after abort named the live holder. Abort's own prescribed recovery ("pause it first") ` +
          `dead-ends at this refusal, and the receipt states a fact the canonical oracle contradicts. ` +
          `Remedy-neutral: consult the same oracle abort consults — refuse naming the holder, or signal the holder ` +
          `it names — never report a live-held Job as not-live.`,
      )

      // the twin verb, same law: refresh's gate (bin:760) reads the same
      // raced half and reports the same false fact
      const re = run("refresh")
      assert.doesNotMatch(
        re.stderr ?? "",
        /orchestrator not live/,
        `INV-3/INV-4 (the refresh twin, bin/whitehartlane:760): the same residue store — abort just refused it ` +
          `naming the live holder ("kill or pause it first") — and refresh answered ` +
          `"refresh: ${job.id} is running (orchestrator not live)" (rc=${String(re.status)}, stderr: ` +
          `${JSON.stringify((re.stderr ?? "").trim())}). The sixth and last unmigrated site of the liveness ` +
          `decision: refresh must answer the canonical oracle (bookingStale/liveLeaseHolder), not the raced ` +
          `record.pid half — never the opposite fact of the verb beside it.`,
      )
    } finally {
      holder.kill(9)
      rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    }
  })
}
