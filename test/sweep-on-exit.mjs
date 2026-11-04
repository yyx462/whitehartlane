// the cleaner at EVERY end (momentum-3105, the 2026-11-04 burst
// receipt): the lane-final sweep only runs after the FULL npm test —
// a single-file run ended with no teardown at all, its orphaned
// watcher lost its fake clock and fake phone with the deleted
// sandbox, rode a REAL clock for 2h, and DMed a human. Loaded via
// --import into every test process (npm test and npm run test:one);
// each process sweeps at ITS exit. Killed: world-gone orphans (the
// 2h bombs) and OLD fixture orphans (a crash's leftover). Spared:
// anything with a live spawner (a sibling mid-shift — the minting
// door itself exits at spawn, so a live commission's watcher is an
// orphan BY DESIGN; the momentum-908 receipt) and young fixture
// orphans (a legit watcher still working its bounded seconds). A run
// that dies without an end (SIGKILL) fires no hook — the NEXT run's
// exit pass reaps its aged orphans.
import { sweepZombies } from "./sweep-zombie-watchers.mjs"

process.on("exit", () => {
  try {
    sweepZombies({ spareInFlight: true, actor: "exit-pass" })
  } catch {
    // never fail a test run for its own cleanup
  }
})
