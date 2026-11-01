// principles-5100 — minting the verdict seat STILL moves the program's
// identity, because linkVerdictSeat creates the seat's PARENT DIRECTORY
// inside the user's source program dir, and contentHashOf hashes
// directory NAMES as it walks.
//
// The change states the law itself, twice:
//
//   src/doors/run.ts:216-220
//     "the verdict SEAT is output, never input: its presence (a link
//      into the run dir) or absence must not change the program's
//      identity — the fold's 'same program?' judgment cannot flip on a
//      seat"
//
//   src/doors/project.ts:114-119
//     "the verdict SEAT is output, never input (questions-20): a symlink
//      at data/review/verdict.json (into the job's run dir) must never
//      move the program's identity"
//
// It neutralises the seat FILE: project.ts:108 OUTPUT_SEATS skips
// data/review/verdict.json at EVERY root, and the walk skips the entry
// BEFORE hashing its name (project.ts:125-128).
//
// But linkVerdictSeat (src/doors/run.ts:142-151) does
// `mkdirSync(dirname(seat), { recursive: true })` — it creates
// <program>/data/review/ INSIDE THE USER'S SOURCE DIR. A program dir
// that had NO data/review/ before the booking therefore gains the
// hashed directory names "data" and "review" the moment the door
// stages it, and contentHashOf(dir) moves even though the seat FILE
// itself is skipped.
//
// The consumers of that hash are the ones that mis-report:
//   src/adapters/store.ts:852  failedWakeWhy → "failed — program
//                              changed since booking: `whl continue`
//                              re-runs the verdict on the same work"
//   bin/whitehartlane:1260     the continue note → "the program source
//                              changed since booking; this rebirth runs
//                              the EDITED program"
//
// Both are FALSE for a program the door itself just staged: the user
// edited nothing.
//
// The repro drives the repo's OWN door — prepareRun (src/doors/run.ts)
// — which books (computing the spur's version at run.ts:461) and then
// stages (run.ts:685 → stageRun → linkVerdictSeat at run.ts:127), and
// then asks the repo's own hasher and the repo's own consumer.
//
// BASE behaviour: BASE's stageRun never creates data/review/ in the
// source dir (BASE has no linkVerdictSeat), so the hash does not move
// and this test PASSES on BASE — the change is what introduced the
// flip.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { failedWakeWhy, type JobRecord } from "../../src/adapters/store.ts"
import { contentHashOf } from "../../src/doors/project.ts"
import { prepareRun } from "../../src/doors/run.ts"

test("principles-5100: staging a program must not change that program's identity", () => {
  const tmp = mkdtempSync(join(tmpdir(), "p5100-seat-"))
  const home = join(tmp, "home")
  const prevHome = process.env.AGENTIC_OS_HOME
  process.env.AGENTIC_OS_HOME = home
  try {
    // a GENERIC program dir — no data/review/ of its own, the shape a
    // plain `whl run <folder>` program has
    const prog = join(tmp, "prog")
    mkdirSync(prog, { recursive: true })
    writeFileSync(
      join(prog, "workflow.toml"),
      "[workflow]\nname='t'\nworker_kind='pi'\n[[stage]]\nid=\"s1\"\ntopology=\"gate\"\nrun=\"bash hooks/x.sh\"\n",
    )
    writeFileSync(
      join(prog, "contract.toml"),
      "[[contract.deliverables]]\nname=\"out\"\npath=\"out.md\"\nkind=\"file\"\n",
    )
    mkdirSync(join(prog, "hooks"), { recursive: true })
    writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 0\n")

    // THE DOOR: booking computes the spur's version (run.ts:461), then
    // staging mints the seat in the source dir (run.ts:127).
    const ready = prepareRun(prog)
    assert.ok(ready.ok, `the program must book: ${ready.ok ? "" : ready.why}`)
    const booked = ready.job.spur?.content_hash
    assert.ok(booked, "the booking must record a spur version")

    // what "program changed since booking" compares, afterwards
    const after = contentHashOf(prog)
    assert.equal(
      after,
      booked,
      "staging must not change the program's identity — the spur's version (src/doors/run.ts:461) is exactly what 'program changed since booking' compares (src/adapters/store.ts:852, bin/whitehartlane:1260). The seat FILE is skipped by OUTPUT_SEATS (project.ts:108), but linkVerdictSeat's mkdirSync(dirname(seat)) (run.ts:146) adds the hashed directory names data/review to the user's source dir, so the hash still moves",
    )

    // the CONSUMER's receipt, on the job the booking wrote
    const job = { spur: ready.job.spur } as unknown as JobRecord
    const why = failedWakeWhy(job, "failed")
    assert.ok(
      !/program changed since booking/.test(why),
      `the wake must not claim the program changed since booking — only the seat the door itself minted was added: "${why}"`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
