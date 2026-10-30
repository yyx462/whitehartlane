// momentum-905 — "ok: true" must mean a commission is OWNED, not merely
// spawned.
//
// The door's own law (bin/whitehartlane:551-553):
//
//   // infra as infra (questions-18): a failed spawn is never an
//   // owned commission — report the fault, own nothing
//   console.error(`review: cannot mint the ship supervisor (${s.why}) —
//     the PR is NOT under review; …`)
//
// …and the receipt it prints on success (bin/whitehartlane:558):
//
//   console.log(`supervisor: pid ${s.pid} owns the review of PR #${pr}`)
//
// spawnSupervisor (src/doors/ship-supervisor.ts:74-88) checks only the
// PREFLIGHT (the bin exists) and the exec's pid; it never checks that the
// spawned agent is still alive, and nothing checks later — the 2-hour
// timeout lives INSIDE the supervisor (ship-supervisor.ts:35, step 7), so
// a supervisor that dies at once posts no timeout comment and sends no
// notify either. The brief itself carries the receipt of that exact arc:
// "a supervisor that exits early abandons the commission … the first live
// supervisor died exactly this way and PR #259 went silent".
//
// So a supervisor that exits immediately (opencode failing to start: no
// auth, no model, a bad CLI flag) is reported as owning the review, the
// PR is never reviewed, and nothing ever says so — the silent-PR hole the
// whole feature exists to close.
//
// The repo already owns the liveness verb this needs:
// src/adapters/store.ts:954 `pidAlive(pid)` — unused here.
//
// The repro spawns a bin that exits immediately and asserts that the
// door's ownership claim is backed by a live process.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist there — so
// on BASE this test passes.
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("a spawn that dies at once must not be reported as an owned commission", async () => {
  const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
  if (!supervisor) return // BASE shape: no supervisor at all

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom905-"))
  const bin = join(tmp, "dead-supervisor")
  // an agent that cannot start exits at once — no auth, no model, a bad flag
  writeFileSync(bin, "#!/bin/sh\nexit 1\n")
  chmodSync(bin, 0o755)

  const s = supervisor.spawnSupervisor({ brief: "BRIEF", cwd: tmp, logPath: join(tmp, "sup.log"), bin })
  assert.ok(s.ok, `the door must not report an owned commission for a supervisor that died at once (why: ${s.ok ? "" : s.why})`)
  // the door's receipt says "pid N owns the review of PR #42" — the claim
  // must be backed by a live process
  await sleep(600)
  let alive = true
  try {
    process.kill(s.pid, 0)
  } catch {
    alive = false
  }
  assert.ok(
    alive,
    `the door printed "supervisor: pid ${s.pid} owns the review" for a process that is already dead — nothing watches it afterwards (the 2h timeout lives inside the supervisor), so the PR is never reviewed and never reported`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
