// the suite's own teardown (the zombie-watcher receipt, 2026-10-30):
// every test that mints a supervisor leaves a REAL detached watcher
// behind — the test deletes its tmp dir, the watcher never sees its
// outcome, and two hours later it DMs a human "PR # review timed
// out". The gone-world exit ends the class for NEW watchers; this
// sweep ends it for whatever the run left mid-flight (old-spell
// watchers, tests that failed before their rm). npm test runs this
// LAST — the runner owns its teardown.
//
// THE RULE lives in src/doors/watcher-sweep.ts (one law, three seats:
// this lane-final tail, the per-exit pass, and the whl sweep janitor —
// momentum-3105). This file keeps the CLI seat and the test-lane
// import path stable; every kill lands in the janitor kill log.
const mod = await import("../src/doors/watcher-sweep.ts")

export const sweepZombies = mod.sweepZombies
export const killLogPath = mod.killLogPath
export const FIXTURE_ORPHAN_GRACE_S = mod.FIXTURE_ORPHAN_GRACE_S

// CLI (npm test's lane-final pass): the total rule — nothing is in
// flight when the whole lane has ended. Actor names the seat in the
// kill log.
import { pathToFileURL } from "node:url"
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly && !mod.sweepZombies({ actor: "lane-final" })) {
  console.log("no zombie watchers (the suite leaves none behind)")
}
