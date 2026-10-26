// station-pause.test.ts — ADR 0016 tenancy: a hosted station is a
// TENANT of the parent's rail, never its owner. Three pins, all with
// the REAL coworker engine hosted through the REAL rail (the
// composite pattern) and pause driven by rail.drainHook?.() — the
// lab-pause house pattern:
//
//  1. pause DURING a station: the drain stack unwinds LIFO (the
//     station ends its member turns, then the parent arms its park);
//     the run parks (null report), the station sweeps ONLY its member
//     panes, and the parent's own retireAll runs exactly once (at its
//     park — the old code ran it at the station's end too, pkill -9
//     over the parent's run dir and all: the early-R6 class).
//  2. pause AFTER a station: the station's disposer removed its drain
//     when the flight ended — the parent's drain is what remains, and
//     it still parks the run (the old single-slot bug left a dead
//     closure and the run finished instead of parking).
//  3. a FAILING station (relay cap): the fail path sweeps only its
//     members — the parent's rail, chrome, and run dir untouched.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator } from "../src/engines/orchestrator.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-station-pause-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function stationDir(prefix: string): string {
  const dir = join(process.env.AGENTIC_OS_HOME!, prefix)
  mkdirSync(join(dir, "hooks"), { recursive: true })
  return dir
}

function coworkerChain(prefix: string, after: "gate" | "unit"): string {
  const dir = stationDir(prefix)
  const tail =
    after === "gate"
      ? '\n[[stage]]\nid = "grade"\ntopology = "gate"\nrun = "true"\n'
      : '\n[[stage]]\nid = "payload"\ntopology = "solo"\nbrief = "after the exchange"\n'
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "${prefix.trimEnd("-")}"
worker_kind = "opencode"

[[stage]]
id = "review"
topology = "coworker"
members = [
  { name = "alex", brief = "work with sam", initiates = true },
  { name = "sam", brief = "on alex's mail, answer" },
]
${tail}`,
  )
  writeFileSync(
    join(dir, "contract.toml"),
    "[[contract.deliverables]]\nname = \"exchange-record\"\npath = \"stations/review/relay.json\"\nkind = \"json\"\n",
  )
  return dir
}

const mail = (dir: string, who: string, seq: number, to: string, type: string, body: string) => {
  mkdirSync(join(dir, "stations", "review", "messages", who), { recursive: true })
  writeFileSync(
    join(dir, "stations", "review", "messages", who, `${seq}.json`),
    JSON.stringify({ from: who, to, type, body }),
  )
}

test("pause DURING a station: the stack unwinds LIFO, the run parks, and the parent's retireAll fires exactly once", async () => {
  const dir = coworkerChain("during-", "gate")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const logs: string[] = []
  const rail = fakeRail(dir, herdr, ledger as never, { log: (m) => logs.push(m) })

  herdr.onPrompt = (name, _text, later) => {
    if (!name.startsWith("alex")) return
    // alex is mid-turn when SIGTERM lands; the member then ends its turn
    herdr.phase[name] = "working"
    later(() => {
      rail.drainHook?.() // the trap body: LIFO — station's drain, then the parent's
      later(() => {
        herdr.phase[name] = "idle"
      })
    })
  }

  const report = await runOrchestrator({
    taskDir: dir,
    shep: rail as never,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    deadlineMs: 30_000,
    log: (m) => logs.push(m),
  })

  // the run PARKED with the station — never a failed station row
  assert.equal(report, null, "a parked station parks the run (null report)")
  assert.ok(logs.some((l) => l.includes("coworker: pause requested — draining")), "the station's drain armed")
  assert.ok(logs.some((l) => l.includes("orchestrator: pause requested — draining")), "the parent's drain armed TOO (the stack)")
  assert.ok(logs.some((l) => l.includes("station review: exchange parked — the run parks with it")), "the parked station was not a failed row")
  assert.ok(logs.some((l) => l.includes("coworker: retired 2 member pane(s)")), "the station swept its OWN members")
  // tenancy, mechanism-level: the parent's retireAll (with the pkill
  // tail over the run dir) belongs to the PARENT's park — exactly once.
  // The old code ran it at the station's end as well.
  assert.equal(
    logs.filter((l) => l.includes("retired every pane this orchestrator spawned")).length,
    1,
    "retireAll is the parent's alone",
  )
  // the exchange is resumable: the station's own bytes persist
  assert.ok(existsSync(join(dir, "stations", "review", "protocol.json")), "the station booked itself")
  assert.ok(existsSync(join(dir, "stations", "review", "briefs", "alex.md")), "member briefs persist for the resume")
  // the parent's drain outlived the station's (the disposer removed only the station's)
  assert.ok(rail.drainHook, "the parent's drain remains installed after the station parked")
  assert.equal(existsSync(join(dir, "report.json")), false, "parked writes no run report")
})

test("pause AFTER a station: the station disposed its drain — the parent's still parks the run", async () => {
  // the post-station window is a PENDING unit, not a passed gate (a
  // complete chain finishes — completion outranks parking, honestly).
  // The unit spawns after the station settles and stays working; the
  // drain then fires with ONLY the parent's hook installed (the
  // station disposed its own at its end) and a short ceiling force-
  // parks the run with the unit's session booked.
  const dir = coworkerChain("after-", "unit")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const logs: string[] = []
  const rail = fakeRail(dir, herdr, ledger as never, { log: (m) => logs.push(m) })
  const stationReport = join(dir, "stations", "review", "report.json")

  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("alex")) {
      later(() => mail(dir, "alex", 2, "sam", "note", "the answer is 42"))
      return
    }
    if (name.startsWith("sam")) {
      later(() => mail(dir, "sam", 3, "alex", "stop", "goal reached"))
      return
    }
    // the downstream unit takes the prompt and works forever
    if (name.startsWith("w-payload")) herdr.phase[name] = "working"
  }

  // fire the drain once the station's engine has fully ended — its
  // report written AND its sweep+dispose (which run after the write)
  // given a beat to land
  let fired = false
  const watcher = setInterval(() => {
    if (!fired && existsSync(stationReport)) {
      fired = true
      clearInterval(watcher)
      setTimeout(() => rail.drainHook?.(), 300)
    }
  }, 50)

  const report = await runOrchestrator({
    taskDir: dir,
    shep: rail as never,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    deadlineMs: 30_000,
    drainMs: 500,
    log: (m) => logs.push(m),
  })
  clearInterval(watcher)

  // the exchange finished green FIRST — the station owns its report
  assert.ok(logs.some((l) => l.includes("station review: done")), "the station settled done before the pause")
  assert.ok(existsSync(stationReport), "the station's report is station-owned")
  // then SIGTERM: only the parent's drain remains — and it parks the
  // run (the old single-slot bug ran the station's dead closure: no
  // park, the unit stalls, the run fails late)
  assert.equal(fired, true, "the post-station drain fired inside the window")
  assert.ok(logs.some((l) => l.includes("orchestrator: pause requested — draining")), "the PARENT's drain armed (the station's was disposed)")
  assert.equal(report, null, "the restored parent drain parked the run")
  assert.ok(logs.some((l) => l.includes("drain ceiling passed")), "the never-settling unit was retired unfinished at the ceiling")
  assert.equal(existsSync(join(dir, "report.json")), false, "parked writes no run report")
})

test("a FAILING station sweeps only its members — the parent's rail untouched", async () => {
  const dir = coworkerChain("failing-", "gate")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const logs: string[] = []
  const rail = fakeRail(dir, herdr, ledger as never, { log: (m) => logs.push(m) })

  // the exchange burns its relay cap with notes that never stop —
  // the cap is the honest failure path, and its sweep is the pin
  process.env.AGENTIC_OS_RELAY_CAP = "2"
  try {
    herdr.onPrompt = (name, _text, later) => {
      if (name.startsWith("alex")) {
        later(() => mail(dir, "alex", 2, "sam", "note", "one"))
        return
      }
      if (name.startsWith("sam")) {
        later(() => mail(dir, "sam", 3, "alex", "note", "two"))
      }
    }
    const report = await runOrchestrator({
      taskDir: dir,
      shep: rail as never,
      gateCheckMs: 50,
      logPollMs: 50,
      stallMs: 60_000,
      briefGraceMs: 60_000,
      deadlineMs: 30_000,
      log: () => {},
    })

    assert.ok(report, "the failed exchange still reports")
    assert.equal(report.status, "failed")
    const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
    assert.match(byUnit.review, /^station review failed/)
    // the sweep: BOTH member panes retired by name — no retireAll from
    // the station, no pkill over the parent's run dir
    assert.ok(logs.some((l) => l.includes("coworker: retired 2 member pane(s)")), "the fail path swept its OWN members")
    const retiredAll = logs.filter((l) => l.includes("retired every pane this orchestrator spawned"))
    assert.equal(retiredAll.length, 1, "retireAll is the parent's report-time sweep alone")
    assert.ok(ledger.killed.some((k) => k.includes("alex")), "alex's pane was killed on the books")
    assert.ok(ledger.killed.some((k) => k.includes("sam")), "sam's pane was killed on the books")
  } finally {
    delete process.env.AGENTIC_OS_RELAY_CAP
  }
})
