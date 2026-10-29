import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-q16-home-"))
process.env.AGENTIC_OS_NOTIFY = "0"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard: the claim-before-spawn ordering is this diff's own
// addition — on BASE spawnRunner neither claims nor vetoes, nothing to
// judge (the prove gate classifies this repro as introduced).
const LEVY_SRC = readFileSync(join(ROOT, "src", "adapters", "levy.ts"), "utf8")
const HEAD_CLAIMS = LEVY_SRC.includes("claimRevivalFlip")

import { openSession, createJob, pauseJob, loadJob } from "../../src/adapters/store.ts"
import { spawnRunner } from "../../src/adapters/levy.ts"

test("a refused revival leaves the parked record it refused to claim — pause receipt intact", () => {
  if (!HEAD_CLAIMS) return // BASE: no claim/veto ceremony — nothing to judge

  const scratch = mkdtempSync(join(tmpdir(), "whl-q16-"))
  try {
    // a parked Job (the record `whl continue` hands to a fresh runner)
    const sess = openSession({ cwd: scratch })
    const job = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "q16", dir: join(scratch, "run") })
    pauseJob(job, "q16 fixture — a parked run", 0) // state:"paused", persisted

    // a live successor booking on the SAME lineage session — the
    // write-site veto's own premise (gate-r23 momentum-60): a booking
    // admitted while the revival ceremony was retiring stragglers
    createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "q16-successor", dir: join(scratch, "run-b") })

    // a door stub that EXISTS (the veto must fire before the spawn, so
    // the stub never executes — it only passes the existsSync check)
    const stub = join(scratch, "door.mjs")
    writeFileSync(stub, "// never runs: the refusal precedes the spawn\n")
    process.env.AGENTIC_OS_ORCHESTRATOR = stub

    // rebirthRunner's tail — the write-site ceremony (levy.ts):
    //   const claim = claimRevivalFlip(job)   // flips the record FIRST
    //   if (!claim.ok) return ...
    //   const veto = successorVetoWhy(job)    // the pure read, AFTER
    //   if (veto) return { ok: false, why: veto }
    const out = spawnRunner(job, ROOT)

    // premise: the write-site veto is what refused (the exact
    // mid-ceremony shape the write-site check exists for)
    assert.ok(
      !out.ok && /successor booking/.test(out.why),
      `premise: the write-site successor veto refused (got ${JSON.stringify(out)})`,
    )

    // THE LAW: a refusal refuses — the record it refused to claim must
    // still read parked, with its pause receipt intact. INV-4 (the
    // record must not lie): the veto's own message prescribes the
    // recovery ("abort the successor first" — then `whl continue`), and
    // `whl continue` gates on a PARKED record; the booking probe and
    // the sweep cannot repair it either (a young pid-less "running"
    // record is a live intent under bookingStale's booking grace —
    // r16 tests-10). A claim that flips before a veto that refuses
    // deletes the pause receipt and strands the revival: state
    // "running" on disk, no runner, no continue, no repair.
    const after = loadJob(sess.id, job.id)
    assert.equal(
      after?.state,
      "paused",
      `INV-4 (a refusal must leave the refused record as it found it — the record must not lie): spawnRunner ` +
        `(src/adapters/levy.ts) orders claimRevivalFlip BEFORE successorVetoWhy, so when the write-site veto ` +
        `refuses (the exact mid-ceremony booking the write-site check exists for), the claim has ALREADY flipped ` +
        `the parked record to "running", deleted its pause receipt, and bumped continues. The refusal's own ` +
        `prescribed recovery is dead-ended: \`whl continue\` gates on a parked record; the booking probe and the ` +
        `sweep cannot repair it (a young pid-less running record is a live intent under bookingStale's grace). ` +
        `After the refusal the record reads ${JSON.stringify(after?.state)} (wanted: "paused", pause receipt ` +
        `${after?.pause === undefined ? "GONE" : "present"}). The veto is a pure read — ask it BEFORE the claim ` +
        `(or restore the parked record on the refusal path).`,
    )
    assert.ok(
      after?.pause !== undefined,
      "the pause receipt must survive a refused revival — the reason the run is parked is the operator's state",
    )
  } finally {
    delete process.env.AGENTIC_OS_ORCHESTRATOR
    rmSync(join(process.env.AGENTIC_OS_HOME!), { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
})
