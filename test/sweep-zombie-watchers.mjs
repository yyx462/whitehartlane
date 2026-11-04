// the suite's own teardown (the zombie-watcher receipt, 2026-10-30):
// every test that mints a supervisor leaves a REAL detached watcher
// behind — the test deletes its tmp dir, the watcher never sees its
// outcome, and two hours later it DMs a human "PR # review timed
// out". The gone-world exit ends the class for NEW watchers; this
// sweep ends it for whatever the run left mid-flight (old-spell
// watchers, tests that failed before their rm). npm test runs this
// LAST — the runner owns its teardown.
//
// EVERY END (momentum-3105, the 2026-11-04 burst receipt): the
// lane-final sweep never runs for single-file invocations, and the
// 18:46 single-file run's orphaned watcher rode a REAL clock for 2h
// before DMing a human at 20:46. sweep-on-exit.mjs now loads this
// module into every test process via --import; the per-exit pass
// SPARES watchers a live process still owns (ppid not 1) and reaps
// only world-gone orphans and spawner-less fixtures — a mid-shift
// sibling file's watcher is not a zombie. Lane-final keeps the total
// rule: at lane end nothing is in flight.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

// a legit door-minted watcher works for bounded seconds and is killed by
// its own test's teardown; a crashed run's leftover lives for minutes.
// Grace exceeds the suite's longest bounded wait (momentum-3104: 2 x 90s).
const FIXTURE_ORPHAN_GRACE_S = 300

const parseEtime = (s) => {
  const parts = s.trim().split(/[-:]/).map(Number)
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return Infinity
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function sweepZombies({ spareInFlight = false, onlyPids } = {}) {
  let killed = 0
  let lines = ""
  try {
    lines = execFileSync("ps", ["ax", "-o", "pid=,ppid=,etime=,command="], { encoding: "utf8" })
  } catch {
    return 0 // no ps, nothing to sweep — never fail a test run for this
  }
  for (const line of lines.split("\n")) {
    // every watcher spell ends in ".log.watch" (sup.log.watch,
    // supervisor.log.watch, autorun.supervisor.log.watch — the name is
    // the watcher's, whatever prefixed it)
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const [, pidS, ppidS, etimeS, cmd] = m
    if (Number(pidS) === process.pid) continue
    // a pin may scope the sweep to ITS OWN watchers — node --test runs
    // files CONCURRENTLY, and a test body running the global sweep
    // would reach into a sibling file's in-flight fixtures
    if (onlyPids && !onlyPids.includes(Number(pidS))) continue
    const script = cmd.trim().split(/\s+/).at(-1) ?? ""
    if (!/[.]log[.]watch$/.test(script)) continue
    // KILL only what a test minted, never a live levy's real watcher:
    // the script's dir is GONE (the gone world), or it lives under the
    // system tmpdir (a fixture — real levies stage under
    // ~/.local/share/agentic-os, never $TMPDIR)
    const gone = !existsSync(dirname(script))
    const fixture = script.startsWith(tmpdir())
    if (!gone && !fixture) continue
    if (spareInFlight) {
      // EVERY END (the momentum-908 receipt, lane 2026-11-04): a
      // door-minted watcher is ORPHANED BY DESIGN from birth — the
      // minting door exits the moment the watch starts — so ppid 1
      // alone is NOT a leak. Three shapes are spared:
      //   live spawner, any world — a sibling test mid-shift/mid-finally
      //   gone world + live spawner — the owner's own teardown owns it
      //   fixture + young orphan — a legit watcher still working
      // Killed: gone world + orphan (the 2h real-clock bomb), and
      // fixture + OLD orphan (a crash's leftover — legit watchers
      // finish in bounded seconds).
      const orphan = Number(ppidS) === 1
      if (!orphan) continue
      if (!gone && parseEtime(etimeS) < FIXTURE_ORPHAN_GRACE_S) continue
    }
    try {
      process.kill(Number(pidS), "SIGTERM")
      killed++
      console.log(`swept zombie watcher pid ${pidS} (${gone ? "world gone" : "fixture"}): ${script}`)
    } catch {
      // already dead — the outcome we wanted
    }
  }
  return killed
}

// CLI (npm test's lane-final pass): the total rule — nothing is in
// flight when the whole lane has ended.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly && !sweepZombies()) {
  console.log("no zombie watchers (the suite leaves none behind)")
}
