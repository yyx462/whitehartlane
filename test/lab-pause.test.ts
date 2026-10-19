import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { labBookings, runLab } from "../src/lab.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

// ADR 5 parity for the lab engine: SIGTERM drains to quiescence and
// parks (null report, sessions booked); a continued lab re-enters the
// experiment — the actor resumes its booked session (never a re-brief),
// in-flight mocks resume theirs, closed mocks settle from their log
// markers without rebirthing a pane.

async function labDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  writeFileSync(join(dir, "workflow.toml"), [
    'kind = "lab"',
    "",
    "[workflow]",
    'name = "test-lab"',
    'worker_kind = "opencode"',
    "",
    "[hooks]",
    "units = \"true\"",
    'grade = "g() { test -s units/$1/result.md && echo planted; }; g"',
    'counts = "printf \'{}\'"',
    "",
  ].join("\n"))
  writeFileSync(join(dir, "actor.md"), "Plant the flag.\n")
  return dir
}

function seedBooking(
  ledger: ReturnType<typeof fakeLedger>,
  unit: string,
  sessionId: string,
): void {
  ledger.job.panes.push({
    label: `${unit}-r1`,
    unit,
    transcript: { tool: unit === "actor" ? "pi" : "opencode", session_id: sessionId, cwd: ledger.job.dir },
    born: "2026-10-19T00:00:00.000Z",
  })
}

test("labBookings: the entry fold — latest booking per raw unit name, mocks keyed by id", () => {
  const ledger = fakeLedger()
  seedBooking(ledger, "actor", "sess-actor")
  seedBooking(ledger, "mock-flag", "sess-flag-1")
  // a younger re-birth of the same mock wins
  ledger.job.panes.push({
    label: "mock-flag-r2",
    unit: "mock-flag",
    transcript: { tool: "pi", session_id: "sess-flag-2", cwd: ledger.job.dir },
    born: "2026-10-19T01:00:00.000Z",
  })
  // noise: no transcript, another role's naming scheme
  ledger.job.panes.push({ label: "verbose-x", unit: "verbose", born: "2026-10-19T02:00:00.000Z" })
  const fold = labBookings(ledger)
  assert.equal(fold.actor?.session_id, "sess-actor")
  assert.equal(fold.mocks.get("flag")?.session_id, "sess-flag-2")
  assert.equal(fold.mocks.has("verbose"), false)
  // no ledger (a standalone lab) folds nothing
  const bare = labBookings(null)
  assert.equal(bare.actor, undefined)
  assert.equal(bare.mocks.size, 0)
})

test("SIGTERM parks the lab: the drain waits out the in-flight mock, books nothing, writes no report", async () => {
  const dir = await labDir("lab-park-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const lines: string[] = []
  const rail = fakeRail(dir, herdr, ledger as never, { log: (m) => lines.push(m) })

  let actorPrompts = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("actor")) {
      actorPrompts += 1
      later(() => {
        if (actorPrompts === 1) {
          writeFileSync(join(dir, "protocol.json"), JSON.stringify({
            units: [{ id: "flag", brief: "Plant the flag in result.md." }],
          }))
        }
      })
      return
    }
    if (name.startsWith("mock")) {
      // the mock is born mid-flight; the pause arrives before it ends
      later(() => rail.drainHook?.())
      setTimeout(() => {
        writeFileSync(join(dir, "units", "flag", "log.txt"), "done flag\n")
        writeFileSync(join(dir, "units", "flag", "result.md"), "🚩 planted\n")
        writeFileSync(join(dir, ".beat"), "1")
      }, 150).unref()
    }
  }

  const report = await runLab(rail)
  assert.equal(report, null, "the lab parked, not finished")
  assert.equal(existsSync(join(dir, "report.json")), false, "no report on a park")
  assert.ok(lines.some((l) => l.includes("pause requested — draining")), "the drain armed")
  assert.ok(lines.some((l) => l.includes("parked — paused")), "the park booked")
  // panes retired (sessions stay booked in the pane records)
  assert.ok(ledger.killed.some((label) => label.includes("mock-flag")))
  assert.ok(ledger.killed.some((label) => label.includes("actor")))
})

test("a continued lab resumes the actor's and the in-flight mock's booked sessions", async () => {
  const dir = await labDir("lab-continue-")
  // the parked generation's state: the wave was named, the mock was
  // mid-flight (no log marker), both minds carry booked sessions
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({
    units: [{ id: "flag", brief: "Plant the flag in result.md." }],
  }))
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  seedBooking(ledger, "actor", "sess-actor")
  seedBooking(ledger, "mock-flag", "sess-flag")
  const rail = fakeRail(dir, herdr, ledger as never)

  const actorPrompts: string[] = []
  const mockPrompts: string[] = []
  let stops = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("actor")) {
      actorPrompts.push(text)
      if (text.includes("Wave closed.")) {
        later(() => {
          stops += 1
          writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))
        })
      }
      return
    }
    if (name.startsWith("mock")) {
      mockPrompts.push(text)
      // whatever the prompt is, the mock finishes its unit
      later(() => {
        writeFileSync(join(dir, "units", "flag", "log.txt"), "done flag\n")
        writeFileSync(join(dir, "units", "flag", "result.md"), "🚩 planted\n")
        writeFileSync(join(dir, ".beat"), "1")
      })
    }
  }

  const report = await runLab(rail)
  assert.ok(report, "the continued lab finished with a report")
  assert.equal(report.status, "done")
  // the actor RESUMED its session — one nudge, never a re-brief
  const actorStart = herdr.calls.find((a) => a[0] === "agent" && a[1] === "start" && a[2]!.includes("actor"))
  assert.ok(actorStart, "the actor pane started")
  assert.ok(actorStart!.includes("--session") && actorStart!.includes("sess-actor"))
  assert.match(actorPrompts[0]!, /parked and has been continued/, "the first actor prompt is the continue nudge")
  assert.ok(!actorPrompts[0]!.includes("You are the actor"), "no re-brief into the resumed session")
  // the mock RESUMED its session too — held, then nudged (no brief text)
  const mockStart = herdr.calls.find((a) => a[0] === "agent" && a[1] === "start" && a[2]!.includes("mock-flag"))
  assert.ok(mockStart, "the mock pane started")
  assert.ok(mockStart!.includes("--session") && mockStart!.includes("sess-flag"))
  assert.match(mockPrompts[0]!, /session resumed/, "the mock's first prompt is the continue nudge")
  assert.ok(!mockPrompts[0]!.includes("append exactly this line"), "the mock was not re-briefed")
  const flag = report.table.find((row) => row.unit === "flag")
  assert.match(String(flag?.result), /planted/)
})

test("a carried mock whose log already says done settles without rebirthing a pane", async () => {
  const dir = await labDir("lab-carried-done-")
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({
    units: [{ id: "flag", brief: "Plant the flag in result.md." }],
  }))
  mkdirSync(join(dir, "units", "flag"), { recursive: true })
  writeFileSync(join(dir, "units", "flag", "log.txt"), "done flag\n")
  writeFileSync(join(dir, "units", "flag", "result.md"), "🚩 planted\n")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  seedBooking(ledger, "mock-flag", "sess-flag")
  seedBooking(ledger, "actor", "sess-actor")
  const rail = fakeRail(dir, herdr, ledger as never)

  let actorPrompts = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("actor")) {
      actorPrompts += 1
      if (text.includes("Wave closed.")) {
        later(() => writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true })))
      }
      return
    }
    if (name.startsWith("mock")) throw new Error("a closed mock must not be prompted")
  }

  const report = await runLab(rail)
  assert.ok(report)
  const mockStart = herdr.calls.find((a) => a[0] === "agent" && a[1] === "start" && a[2]!.includes("mock-flag"))
  assert.equal(mockStart, undefined, "no pane reborn for finished work")
  const flag = report.table.find((row) => row.unit === "flag")
  assert.match(String(flag?.result), /planted/, "the marker alone settles the row")
})

test("a mock dying mid-drain is carried open for the next generation, not failed", async () => {
  const dir = await labDir("lab-drain-dead-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const lines: string[] = []
  const rail = fakeRail(dir, herdr, ledger as never, { log: (m) => lines.push(m) })

  let actorPrompts = 0
  herdr.onPrompt = (name, text, later) => {
    if (name.startsWith("actor")) {
      actorPrompts += 1
      if (actorPrompts === 1) {
        later(() => {
          writeFileSync(join(dir, "protocol.json"), JSON.stringify({
            units: [{ id: "flag", brief: "Plant the flag in result.md." }],
          }))
        })
      }
      return
    }
    if (name.startsWith("mock")) {
      // the pause arrives, then the mock's pane dies before it ends
      later(() => {
        rail.drainHook?.()
        herdr.phase[name] = "dead"
        writeFileSync(join(dir, ".beat"), "1")
      })
    }
  }

  const report = await runLab(rail, { graceMs: 0 })
  assert.equal(report, null, "parked, not a failed finish")
  assert.ok(lines.some((l) => l.includes("carried open")), "the dead mock was carried open for resume")
  assert.equal(existsSync(join(dir, "report.json")), false)
})

test("the drain parks immediately when nothing is in flight (actor idle, no mocks)", async () => {
  const dir = await labDir("lab-park-idle-")
  const herdr = fakeHerdr()
  const lines: string[] = []
  const rail = fakeRail(dir, herdr, null, { log: (m) => lines.push(m) })
  herdr.onPrompt = (name, _text, later) => {
    if (name.startsWith("actor")) {
      later(() => {
        rail.drainHook?.()
        writeFileSync(join(dir, ".beat"), "1")
      })
    }
  }
  const report = await runLab(rail)
  assert.equal(report, null)
  assert.ok(lines.some((l) => l.includes("parked — paused")))
})
