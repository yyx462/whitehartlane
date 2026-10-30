import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the job store rides the OS-disk home — pin a private one before
// anything imports the store (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-m70-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")

// BASE shape guard (the momentum-14 device): the claim-before-spawn
// (claimRevivalFlip + the write-site successor veto) is this diff's own
// addition — on BASE spawnRunner spawns unconditionally and the guarded
// scenario cannot arise. Vacuous green there by construction.
const HAS_CLAIM = existsSync(join(ROOT, "src", "adapters", "store.ts"))
  ? readFileSync(join(ROOT, "src", "adapters", "store.ts"), "utf8").includes("export function claimRevivalFlip")
  : false

if (!HAS_CLAIM) {
  test("momentum-70: BASE — no claim-before-spawn at the write site, nothing to judge", () => {})
} else {
  const {
    bookingStale,
    claimRevivalFlip,
    createJob,
    findOrOpenSession,
    loadJob,
    pauseJob,
  } = await import("../../src/adapters/store.ts")
  const { spawnRunner } = await import("../../src/adapters/levy.ts")

  // INV-4 (the record must not lie) / the claim's own law (store.ts
  // claimRevivalFlip, gate-r22 momentum-50: "with the same write-site
  // guards continueJob carries — the twin revival stands; a superseding
  // receipt stands").
  //
  // spawnRunner's ordering at the write site is: claim → veto → spawn.
  // The claim (claimRevivalFlip) flips a PARKED record to running,
  // DELETES its pause receipt, bumps `continues`, and saves — all before
  // the successor veto (gate-r23 momentum-60, seated "beside the claim")
  // gets its turn. When the veto refuses — a successor booking is live
  // on the lineage session, the exact mid-ceremony shape momentum-60's
  // fix targets — the refusal returns WITHOUT spawning, but the claim it
  // sits behind has already landed on disk. The parked record is gone:
  // state "running", pause receipt erased, continues bumped, pid
  // unset/old. The refusal's own message prescribes the recovery —
  // "abort the successor first" — and after doing exactly that,
  // `whl continue` refuses at the state gate ("is running, not
  // paused/aborted/orphaned"); the probe/sweep cannot repair it either,
  // because a pid-less young "running" record is a LIVE INTENT under the
  // canonical oracle (bookingStale → booking grace). The receipt-stands
  // law the same function carries for OTHER writers ("a receipt that
  // differs from the caller's snapshot STANDS") is inverted by the
  // claimant itself on its own refusal path: the veto's refusal must
  // leave the parked record it refused to revive.
  //
  // Deterministic: a paused Job A and a live successor B (running, live
  // pid, no lease → bookingStale false) on ONE lineage session;
  // spawnRunner(A) is the production write site (rebirthRunner reaches it
  // after its entry check — the window the write-site check exists for).
  test("a refused revival must leave the parked record it refused to claim", () => {
    const scratch = mkdtempSync(join(tmpdir(), "whl-m70-run-"))
    // the revival's runner door: the veto must be what refuses, so the
    // door only needs to EXIST (the veto returns before any spawn)
    writeFileSync(join(scratch, "door.mjs"), "process.exit(0)\n")
    process.env.AGENTIC_OS_ORCHESTRATOR = join(scratch, "door.mjs")
    try {
      const { session } = findOrOpenSession({
        cwd: scratch,
        host: { tool: "test", session_id: "m70", session_file: "m70" },
      }) as { session: { id: string } }
      const sid = session.id

      // ── the parked revival target: a real booked Job, drained to paused
      const a = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t", dir: join(scratch, "a") })
      pauseJob(a, "m70: drained past the ceiling", 0)
      const parked = loadJob(sid, a.id)!
      assert.equal(parked.state, "paused", "sanity: A is parked on disk")
      assert.ok(parked.pause, "sanity: A carries its pause receipt")

      // ── the live successor booking: same lineage session, running, a
      // LIVE pid, no lease — the canonical oracle must call it live
      const b = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "s", dir: join(scratch, "b"), pid: process.pid })
      assert.equal(
        bookingStale(loadJob(sid, b.id)!, Date.now()),
        false,
        "premise: the successor is a live booking under the stale-booking oracle",
      )

      // ── the write site: claim → veto. The veto must refuse (B is live).
      const out = spawnRunner(parked, ROOT)
      assert.ok(
        !out.ok && /successor booking/.test(out.why),
        `premise: the write-site successor veto must be what refused (got ok=${String(out.ok)}, why=${"why" in out ? out.why : "n/a"})`,
      )

      // THE LAW: the refusal leaves the parked record standing — the
      // veto declined the revival, so the claim behind which it sits must
      // not have landed either.
      const after = loadJob(sid, a.id)!
      assert.equal(
        after.state,
        "paused",
        `INV-4 (the record must not lie) / the claim's own receipt-stands law: spawnRunner orders claim BEFORE ` +
          `veto, so when the write-site successor veto refuses (mid-ceremony booking — the exact shape the ` +
          `write-site check exists for), claimRevivalFlip has ALREADY flipped the parked record to running, ` +
          `deleted its pause receipt, and bumped continues — the refusal's own prescribed recovery ("abort the ` +
          `successor first" — then \`whl continue\`) is dead-ended at the continue verb's state gate ` +
          `("is running, not paused/aborted/orphaned"), and the probe/sweep cannot repair it because a young ` +
          `pid-less running record is a live intent under bookingStale's booking grace. After the refusal the ` +
          `record reads ${after.state} (wanted: paused). The veto must sit BEFORE the claim (it is a pure read), ` +
          `or the refusal path must restore the parked record.`,
      )
      assert.ok(
        after.pause,
        `INV-4: the pause receipt was erased by a revival that was REFUSED — receipt gone: ${JSON.stringify(after.pause)}`,
      )
      assert.equal(
        after.continues ?? 0,
        0,
        `INV-4: \`continues\` counts revivals (the claim's own words) — a REFUSED revival bumped it to ${after.continues}`,
      )
    } finally {
      delete process.env.AGENTIC_OS_ORCHESTRATOR
      rmSync(join(HOME, "sessions"), { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  })
}
