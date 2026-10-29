import assert from "node:assert/strict"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the host session store rides
// OPENCODE_DB — pin both before anything reads them (the repo's own
// repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m90-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m90-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import { benchOrder, cycle, type CycleDeps } from "../../src/engines/orchestrator.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"

// BASE shape: the birth judge is this diff's own addition. No birth seat
// on BASE → nothing to judge (the momentum-14 device: vacuous green on
// BASE, so the prove gate classifies this repro as introduced).
if (!benchOrder({ faults: true }).includes("birth")) {
  test("skipped on BASE: the birth judge does not exist there", () => {})
} else {
  // The host store CONTAINS the prior generation's session — the
  // same-machine ADR-5 continue (the resume arc's normal habitat).
  // momentum-80 pinned the post-prune half (the store LOST the id);
  // this repro is the surviving-predecessor half one case over.
  function hostStoreWithPriorSession(dir: string, sid: string): void {
    const db = new DatabaseSync(dir)
    db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
    db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
    db.prepare("INSERT INTO session_v2 (id, directory, time_created) VALUES (?, ?, ?)").run(sid, "/prior-run", 1000)
    db.close()
  }

  function fixtureUnits(where: string): void {
    cpSync(join(import.meta.dirname, "..", "fixtures", "three-lookups"), where, { recursive: true })
  }

  // INV-4 — the change's own promise (templates/pr-review/workflow.toml's
  // born_ms comment: "a pane that never BOARDS … kill + respawn within
  // minutes, never ride the 30-min ceiling") on the ADR-5 continue arc,
  // same machine. rail.resumeWorker books the PRIOR run's session id
  // verbatim on the pane's row (attach, session_id verbatim — no
  // resolution, no liveness). The r26 fix (momentum-80) made
  // rail.bookedSessionOf verify the pointer against the host store — but
  // EXISTENCE is the check, and the predecessor's session on the SAME
  // machine exists. A resumed pane whose agent never starts (the
  // j-4a0009 transport class: start succeeds, nothing ever lands) is
  // therefore "boarded" forever on its predecessor's booking: born_ms
  // never fires, the pane rides the full stall ceiling, and the stall
  // close settles it "stalled" as an ANSWER (faultsCanary defaults true
  // — the canary trips, the label reserved for "a REAL answer failed").
  // The boarding oracle must be THIS generation's evidence: a pointer to
  // a session with no activity since the pane's own born stamp is the
  // predecessor's, not boarding (the repo's own generation-scoped
  // resolver — resolveLiveSession(kind, cwd, since) — already speaks
  // this law for NEW bookings).
  test("a resumed pane is not boarded on a SURVIVING predecessor's untouched session", () => {
    hostStoreWithPriorSession(DB, "ses-prior-alive")
    const runDir = mkdtempSync(join(tmpdir(), "whl-m90-run-"))
    const units = mkdtempSync(join(tmpdir(), "whl-m90-units-"))
    try {
      fixtureUnits(units)
      const herdr = {
        calls: [] as string[][],
        phase: {} as Record<string, string>,
        runner: (args: string[]) => {
          herdr.calls.push(args)
          if (args[0] === "pane" && args[1] === "split") return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: `p-${herdr.calls.length}` } } }) }
          if (args[0] === "tab" && args[1] === "create") return { status: 0, stdout: JSON.stringify({ result: { root_pane: { pane_id: "p-root" } } }) }
          if (args[0] === "agent" && args[1] === "start") {
            herdr.phase[args[2]!] = "idle" // the start SUCCEEDS — and nothing ever lands: the transport class
            return { status: 0, stdout: JSON.stringify({ result: {} }) }
          }
          return { status: 0, stdout: "" }
        },
      }
      const ledger = {
        events: [] as { kind: string; payload: Record<string, unknown> }[],
        job: { id: "j-m90", sid: "s-m90", stoodUpBy: "standalone", workflow: "fan-out", task: "m90", dir: runDir, state: "running", created: new Date().toISOString(), panes: [] as { label: string; pane?: string; unit: string; transcript?: { session_id?: string }; born: string }[] },
        renew: () => {},
        emit: (kind: string, payload: Record<string, unknown>) => ledger.events.push({ kind, payload }),
        attach: (label: string, pane: string | undefined, unit: string, transcript: { session_id?: string } = {}) => {
          ledger.job.panes.push({ label, pane, unit, transcript, born: new Date().toISOString() })
        },
        kill: () => {},
        finish: () => {},
        abort: () => {},
        pause: () => {},
        setSession: (label: string, sessionId: string) => {
          const rec = [...ledger.job.panes].filter((p) => p.label === label).pop()
          if (rec) rec.transcript = { ...rec.transcript, session_id: sessionId }
        },
      }
      const rail = new Rail({
        argvDir: runDir,
        ledger: ledger as never,
        log: () => {},
        shepRunner: () => ({ status: 0, stdout: "" }),
        herdrRunner: herdr.runner as never,
      })

      const events: { kind: string; payload: Record<string, unknown> }[] = []
      let clock = 0
      const deps: CycleDeps = {
        taskDir: units,
        hooks: hooksFromDir(units).hooks,
        shep: rail,
        inFlight: new Map(),
        attempts: new Map(),
        slots: 2,
        stallMs: 60_000,
        bornMs: 1_000,
        briefGraceMs: 60_000,
        now: () => clock,
        emit: (kind, payload) => events.push({ kind, payload }),
        // ADR-5 continue, SAME MACHINE: france resumes from a prior
        // booking whose session STILL EXISTS in the host store
        resumes: new Map([
          ["france", { tool: "opencode", cwd: runDir, session_id: "ses-prior-alive" }],
        ]),
        faults: {
          sessionOf: (unitId) => rail.bookedSessionOf(unitId),
          rebook: (unitId) => rail.tryBookSession(unitId) ?? undefined,
          cwdOf: () => runDir,
          workerStatus: () => "unknown", // never "working": the birth window's exemption cannot mask this
          latestSessionFault: () => null,
          switchSessionModel: () => {},
          promptAgent: () => true,
        },
      }

      cycle(deps) // t=0: the unit resume-spawns; the prior id books on france's row verbatim

      // premise (mechanism, fix-robust): france's row exists and carries
      // a pointer — the resume booked A session id on it. (The adopted
      // momentum-80 lesson: the premise must not read through the oracle
      // the fix itself changes, so the id's VALUE is diagnostic only.)
      const franceRow = ledger.job.panes.find((p) => p.unit === "w-france")
      assert.ok(franceRow?.transcript, `premise: the resume booked a pointer on france's row (rows: ${JSON.stringify(ledger.job.panes)})`)
      const oracleAnswer = rail.bookedSessionOf("france")

      clock = 1_500 // past bornMs (1s): the birth judge's armed look
      cycle(deps)

      // THE LAW: a pointer to a session with no activity since the
      // pane's own born stamp is the predecessor's booking, not THIS
      // pane's boarding evidence — the judge must rule at born_ms.
      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.ok(
        reborn.includes("france"),
        `INV-4: "boarding" on the ADR-5 continue arc is answered by rail.bookedSessionOf (rail.ts bookedSessionOf), whose only ` +
          `verification is opencodeSessionExists(pointer) — the predecessor session's EXISTENCE. On a same-machine continue ` +
          `(the arc's normal habitat) the predecessor's session always exists, so a resumed pane whose agent never starts ` +
          `(the j-4a0009 transport class — the fake host start succeeded, nothing ever landed) reads as boarded forever: ` +
          `born_ms never fires, the pane rides the full stall ceiling born_ms exists to cut, and the stall close then settles ` +
          `it "stalled" as an ANSWER with faultsCanary defaulting true — the canary trips on a transport death, the exact ` +
          `label violation (#144) the diff fixed at its four other transport seats. ` +
          `unit.reborn events at the bornMs beat: ${JSON.stringify(events.filter((e) => e.kind === "unit.reborn"))}; ` +
          `france's booked pointer: ${JSON.stringify(franceRow?.transcript)}; bookedSessionOf answered ` +
          `${JSON.stringify(oracleAnswer)} — the predecessor's untouched session (no activity after the pane's born stamp) ` +
          `must not be this generation's boarding evidence, or the birth judge's own promise ("kill + respawn within ` +
          `minutes, never ride the 30-min ceiling") is false on the continue arc. The control: a normally-spawned ` +
          `never-boarded pane (japan/peru, no pointer) IS ruled at the same beat.`,
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }
  })
}
