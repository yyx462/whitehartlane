// principles-5102 — the ship watcher exits at once because the staged
// program dir ($OUT) does not exist YET, so the backstop that is
// supposed to outlive the agent is gone before the agent has even
// finished booting.
//
// The change's own law (src/doors/ship-supervisor.ts:63-71, and the
// file's header at :1-12):
//
//   "The watcher is the watch: it runs the agent, waits for the verdict
//    at the seat the door PROMISED (the staged dir's link into the job's
//    run dir), and reports the silence itself when the deadline passes
//    — so the commission is watched even when its agent is not."
//
//   "a supervisor that dies at once (no auth, no model, a bad flag)
//    left the PR unreviewed AND unreported, because the 2-hour timeout
//    lived INSIDE the agent."
//
// The watcher script's gone-world exit (src/doors/ship-supervisor.ts:
// the `if [ ! -d "$OUT" ]; then exit 4; fi` line) is meant for a
// watcher whose staged dir was DELETED (a cancelled round, a test's
// tmp dir). But in the REAL --auto flow the staged dir does not exist
// YET at spawn time: bin/whitehartlane:519-523 deliberately NEVER
// pre-creates the --out dir ("the --out dir is NEVER pre-created
// (principles-1000, the P0)"), and the dir only appears once the
// supervisor AGENT has booted and the levy it runs has materialized
// it.
//
// So the watcher's very first loop iteration (sleep 1, then the
// gone-world check) sees a missing $OUT and exits 4 — before the
// agent has booted. The watcher then never posts the timeout comment
// and never sends the notify, so the exact failure the watcher was
// added for (an agent that dies at once → the PR unreviewed AND
// unreported) is back.
//
// The repro drives the repo's OWN spawnSupervisor with a stub agent
// that behaves like the real one: it takes a while to boot, and only
// then does the staged dir appear (the levy materializing it). The
// watcher must still be alive when the seat lands.
//
// BASE behaviour: BASE has no src/doors/ship-supervisor.ts at all, so
// the test SKIPS on BASE and the finding is introduced.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("principles-5102: the ship watcher must outlive the agent it watches", async () => {
  const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
  if (!supervisor) return // BASE shape: no ship supervisor at all

  const tmp = mkdtempSync(join(tmpdir(), "p5102-watch-"))
  try {
    const bin = join(tmp, "stub-opencode")
    const out = join(tmp, "staged") // NEVER pre-created — exactly the --auto shape
    // the stub AGENT: it boots (a real headless opencode takes a while),
    // and only then does the levy materialize the staged dir. It NEVER
    // writes the seat, so the watcher must still be waiting.
    writeFileSync(
      bin,
      `#!/bin/sh\nsleep 4\nmkdir -p "${out}/data/review"\nprintf '{"outcome":"accept"}\\n' > "${out}/data/review/merge.json"\nsleep 30\n`,
    )
    chmodSync(bin, 0o755)

    const s = supervisor.spawnSupervisor({
      brief: "BRIEF",
      cwd: tmp,
      logPath: join(tmp, "sup.log"),
      bin,
      outDir: out,
      pr: "42",
      repo: tmp,
    })
    assert.ok(s.ok, `the watcher must spawn: ${s.ok ? "" : s.why}`)

    // give the agent time to boot and materialize the staged dir
    await sleep(6000)
    assert.ok(
      existsSync(join(out, "data", "review", "merge.json")),
      "the stub agent must have materialized the staged dir and landed the seat",
    )

    let alive = true
    try {
      process.kill(s.pid, 0)
    } catch {
      alive = false
    }
    assert.ok(
      alive,
      `the ship watcher exited while the commission was still running — its gone-world exit (src/doors/ship-supervisor.ts: the \`if [ ! -d "$OUT" ]; then exit 4; fi\` line) fires on a staged dir that has not been MATERIALIZED YET. bin/whitehartlane:519-523 never pre-creates the --out dir, so the watcher exits ~1s after spawn, before the agent boots — and the backstop that must report a dead agent (the 2h timeout comment and the notify) never fires`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
