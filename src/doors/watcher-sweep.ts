// src/doors/watcher-sweep.ts — the zombie-watcher cleaner: one rule,
// three clocks (momentum-3105, the 2026-11-04 burst receipt).
//
// A door-minted watch script (.log.watch) is DETACHED BY DESIGN — the
// minting door exits the moment the watch starts, so the watcher
// outlives its commissioner (momentum-905: "the watch outlives the
// agent"). That design is also the leak: a test run or a crashed
// commission can leave a watcher whose fake clock (a stub sleep) and
// fake phone (a stub notify) were deleted with its world — the
// remaining ticks ride a REAL clock, and two hours later a human gets
// a "PR #NN review timed out" DM for a commission that never existed.
//
// THE RULE (one law, three seats — every test-process exit via
// --import, the lane-final CLI tail, and the whl sweep janitor):
//   spared — anything with a live spawner (a sibling mid-shift; the
//            momentum-908 receipt: door-minted watchers are orphaned
//            by design from birth, ppid 1 is their NORMAL shape);
//            a world-gone watcher with a LIVE owner (that test's own
//            teardown owns it); a young fixture orphan still working
//            its bounded seconds (grace below > the suite's longest
//            bounded wait).
//   reaped — a world-gone ORPHAN (the 2h real-clock bomb) and an
//            aged fixture orphan (a crash's leftover).
// Real commissions are untouched by construction: they stage under
// the OS home, never the system tmpdir.
//
// THE KILL LOG (the janitor's receipt, 2026-11-04): every kill is
// appended to <os-home>/janitor.log.jsonl (rotating .1-.3, 1MB each)
// so any agent can answer "who killed my watcher and what do I trace".
// A janitor kill is a SYMPTOM — something died uncleanly — and the
// entry names where to start.
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { homeRoot } from "../core/home.ts"

export type SweepActor = "janitor" | "exit-pass" | "lane-final" | "pin"

// a legit door-minted watcher works for bounded seconds and is killed by
// its own test's teardown; a crashed run's leftover lives for minutes.
// Grace exceeds the suite's longest bounded wait (momentum-3104: 2 x 90s).
export const FIXTURE_ORPHAN_GRACE_S = 300

export const KILL_LOG_MAX_BYTES = 1_048_576
const KILL_LOG_GENERATIONS = 3

export function killLogPath(): string {
  return join(homeRoot(), "janitor.log.jsonl")
}

const parseEtime = (s: string): number => {
  const parts = s.trim().split(/[-:]/).map(Number)
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

// size-based rotation: current -> .1, .1 -> .2, ... oldest falls off.
// Best-effort — a rotation failure never blocks a kill.
export function rotateKillLog(path: string, maxBytes = KILL_LOG_MAX_BYTES): void {
  try {
    if (!existsSync(path) || statSync(path).size <= maxBytes) return
    for (let i = KILL_LOG_GENERATIONS - 1; i >= 1; i--) {
      const from = i === 1 ? path : `${path}.${i - 1}`
      const to = `${path}.${i}`
      if (existsSync(from)) renameSync(from, to)
    }
    renameSync(path, `${path}.1`)
  } catch {
    /* a stuck rotation must never break the sweep */
  }
}

export type SweepOpts = {
  // the every-end/janitor law; false = the lane-final total rule
  spareInFlight?: boolean
  // scope the sweep to given pids (a concurrent test body never runs the global sweep)
  onlyPids?: number[]
  // who is sweeping — rides the kill log so a dead watcher's story names its ending
  actor?: SweepActor
  // kill-log overrides (tests inject a stub path / tiny threshold)
  killLog?: string
  killLogMaxBytes?: number
  // suppress the stdout lines (the daemon's healthy passes stay quiet)
  quiet?: boolean
}

type Kill = { pid: number; ppid: number; ageS: number; script: string; gone: boolean; fixture: boolean; rule: string }

export function sweepZombies(opts: SweepOpts = {}): number {
  const { spareInFlight = false, onlyPids, actor = "lane-final", quiet = false } = opts
  const killLog = opts.killLog ?? killLogPath()
  let lines = ""
  try {
    lines = execFileSync("ps", ["ax", "-o", "pid=,ppid=,etime=,command="], { encoding: "utf8" })
  } catch {
    return 0 // no ps, nothing to sweep — never fail the caller for this
  }
  const kills: Kill[] = []
  for (const line of lines.split("\n")) {
    // every watcher spell ends in ".log.watch" (sup.log.watch,
    // supervisor.log.watch, autorun.supervisor.log.watch — the name is
    // the watcher's, whatever prefixed it)
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const [, pidS, ppidS, etimeS, cmd] = m as unknown as [string, string, string, string, string]
    const pid = Number(pidS)
    if (pid === process.pid) continue
    if (onlyPids && !onlyPids.includes(pid)) continue
    const script = cmd.trim().split(/\s+/).at(-1) ?? ""
    if (!/[.]log[.]watch$/.test(script)) continue
    // KILL only what a test minted, never a live levy's real watcher:
    // the script's dir is GONE (the gone world), or it lives under the
    // system tmpdir (a fixture — real levies stage under the OS home,
    // never $TMPDIR)
    const gone = !existsSync(dirname(script))
    const fixture = script.startsWith(tmpdir())
    if (!gone && !fixture) continue
    const orphan = Number(ppidS) === 1
    if (spareInFlight) {
      if (!orphan) continue // a live spawner owns this watch
      if (!gone && parseEtime(etimeS) < FIXTURE_ORPHAN_GRACE_S) continue // still working its bounded seconds
    }
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // already dead — the outcome we wanted
      continue
    }
    const rule = gone ? "world-gone-orphan" : fixture && orphan && parseEtime(etimeS) >= FIXTURE_ORPHAN_GRACE_S ? "aged-fixture-orphan" : "lane-final-fixture"
    kills.push({ pid, ppid: Number(ppidS), ageS: parseEtime(etimeS), script, gone, fixture, rule })
    if (!quiet) console.log(`swept zombie watcher pid ${pid} (${gone ? "world gone" : "fixture"}): ${script}`)
  }
  if (kills.length > 0) logKills(kills, actor, killLog, opts.killLogMaxBytes ?? KILL_LOG_MAX_BYTES)
  return kills.length
}

// every kill leaves a receipt an agent can trace from: the world dir
// names the commission, the script pins the exact watch, the hints
// name the two places the story continues (the brief beside the watch,
// the notify diary — any DM this watcher managed to send names this
// script as its caller).
function logKills(kills: Kill[], actor: SweepActor, killLog: string, maxBytes: number): void {
  try {
    rotateKillLog(killLog, maxBytes)
    mkdirSync(dirname(killLog), { recursive: true })
    const chunk = kills
      .map((k) =>
        JSON.stringify({
          ts: new Date().toISOString(),
          actor,
          rule: k.rule,
          pid: k.pid,
          ppid: k.ppid,
          age_s: Number.isFinite(k.ageS) ? k.ageS : null,
          script: k.script,
          world: dirname(k.script),
          symptom: "a commission died uncleanly — most kills should not happen",
          trace: [
            `the world dir names the commission: ${dirname(k.script)}`,
            "the mint brief sits beside the script (<script>.brief) — who commissioned this watch",
            "cross-check the notify diary ~/.local/state/notify/log.jsonl — any DM sent names this script as caller",
          ],
        }),
      )
      .join("\n") + "\n"
    appendFileSync(killLog, chunk)
  } catch {
    // best-effort by the system's own law: a log failure never blocks the kill
  }
}
