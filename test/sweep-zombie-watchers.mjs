// the suite's own teardown (the zombie-watcher receipt, 2026-10-30):
// every test that mints a supervisor leaves a REAL detached watcher
// behind — the test deletes its tmp dir, the watcher never sees its
// outcome, and two hours later it DMs a human "PR # review timed
// out". The gone-world exit ends the class for NEW watchers; this
// sweep ends it for whatever the run left mid-flight (old-spell
// watchers, tests that failed before their rm). npm test runs this
// LAST — the runner owns its teardown.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { tmpdir } from "node:os"

let killed = 0
let lines = ""
try {
  lines = execFileSync("ps", ["ax", "-o", "pid=,command="], { encoding: "utf8" })
} catch {
  process.exit(0) // no ps, nothing to sweep — never fail the suite for this
}
for (const line of lines.split("\n")) {
  // every watcher spell ends in ".log.watch" (sup.log.watch,
  // supervisor.log.watch, autorun.supervisor.log.watch — the name is
  // the watcher's, whatever prefixed it)
  const m = line.match(/^\s*(\d+)\s+(.*)$/)
  if (!m) continue
  const [, pid, cmd] = m
  const script = cmd.trim().split(/\s+/).at(-1) ?? ""
  if (!/[.]log[.]watch$/.test(script)) continue
  // KILL only what a test minted, never a live levy's real watcher:
  // the script's dir is GONE (the gone world), or it lives under the
  // system tmpdir (a fixture — real levies stage under
  // ~/.local/share/agentic-os, never $TMPDIR)
  const gone = !existsSync(dirname(script))
  const fixture = script.startsWith(tmpdir())
  if (!gone && !fixture) continue
  try {
    process.kill(Number(pid), "SIGTERM")
    killed++
    console.log(`swept zombie watcher pid ${pid} (${gone ? "world gone" : "fixture"}): ${script}`)
  } catch {
    // already dead — the outcome we wanted
  }
}
if (!killed) console.log("no zombie watchers (the suite leaves none behind)")
