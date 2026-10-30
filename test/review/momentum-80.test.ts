import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the (empty) host session store
// rides OPENCODE_DB — pin both before anything reads them (the repo's own
// repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m80-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m80-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import { benchOrder, cycle, type CycleDeps } from "../../src/engines/orchestrator.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"

// BASE shape: the birth judge is this diff's own addition (benchOrder
// gains the "birth" seat here). No birth seat on BASE → nothing to judge
// (the momentum-14 device: vacuous green on BASE, so the prove gate
// classifies this repro as introduced).
if (!benchOrder({ faults: true }).includes("birth")) {
  test("skipped on BASE: the birth judge does not exist there", () => {})
} else {
  // the exact rows resolveOpencode queries — created EMPTY: whatever
  // session ids ride the resume pointers resolve in NO store, the
  // post-prune / post-machine-move shape of an ADR-5 continue
  function emptyHostStore(dir: string): void {
    const db = new DatabaseSync(dir)
    db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
    db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
    db.close()
  }

  // the shared example program, kept verbatim (both units, slots 2)
  function fixtureUnits(where: string): void {
    cpSync(join(import.meta.dirname, "..", "fixtures", "three-lookups"), where, { recursive: true })
  }

  // INV-3 / INV-4 — the birth judge's own law is "Session existence is
  // the only key" (orchestrator.ts, the birth judge comment). What it
  // actually reads is deps.faults.sessionOf(b.id) — rail.bookedSessionOf —
  // which answers the LEDGER ROW's booked pointer, with no check that the
  // session exists anywhere. On the FRESH path that pointer is this run's
  // own evidence (the row books only ids a resolver just answered). On the
  // RESUME path (ADR-5 continue) it is not: resumeSpawn → rail.resumeWorker
  // → inhabitPane books the PRIOR run's session id verbatim
  // (`sessionId = resumeSession ?? resolve…`, rail.ts inhabitPane) — no
  // resolution, no liveness. A resumed pane whose agent never boards (the
  // j-4a0009 modal class: start succeeds, no session ever lands) is
  // therefore spared by the judge forever on the strength of its DEAD
  // predecessor's booking — born_ms never fires for it, and it rides the
  // full stall ceiling (30 min on the pr-review template) that born_ms
  // exists to cut. The diff's own promise (templates/pr-review/workflow.toml
  // born_ms comment: "a pane that never BOARDS … kill + respawn within
  // minutes, never ride the 30-min ceiling") is false on the continue arc.
  //
  // Differential, deterministic, injected clock: two resumed units in one
  // run, identical except the booking their pointer carries —
  //   france: a STALE prior session id (the store lost it) → the judge
  //     must still rule at bornMs (its rebook consults the store and finds
  //     nothing), not spare on the dead id;
  //   japan: an UNBOOKED pointer (resumeWorker's own "unbooked — briefed
  //     takeover" shape) → the judge rules (control — the machinery works
  //     when no pointer lies).
  // On HEAD france is spared (no unit.reborn) while japan is reborn: the
  // stale id alone defeats the judge.
  test("the birth judge does not take a prior run's dead booking as this pane's boarding evidence", () => {
    emptyHostStore(DB)
    const runDir = mkdtempSync(join(tmpdir(), "whl-m80-run-"))
    const units = mkdtempSync(join(tmpdir(), "whl-m80-units-"))
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
            herdr.phase[args[2]!] = "idle" // the start SUCCEEDS — the modal class never boards, and no session lands
            return { status: 0, stdout: JSON.stringify({ result: {} }) }
          }
          return { status: 0, stdout: "" }
        },
      }
      const ledger = {
        events: [] as { kind: string; payload: Record<string, unknown> }[],
        job: { id: "j-m80", sid: "s-m80", stoodUpBy: "standalone", workflow: "fan-out", task: "m80", dir: runDir, state: "running", created: new Date().toISOString(), panes: [] as { label: string; pane: string; unit: string; transcript?: { session_id?: string }; born: string }[] },
        renew: () => {},
        emit: (kind: string, payload: Record<string, unknown>) => ledger.events.push({ kind, payload }),
        attach: (label: string, pane: string, unit: string, transcript: { session_id?: string } = {}) => {
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

      // engine.ts's exact faults lambdas, verbatim
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
        // ADR-5 continue: france resumes from a PRIOR booking whose
        // session no longer exists in any store; japan resumes unbooked
        resumes: new Map([
          ["france", { tool: "opencode", cwd: runDir, session_id: "ses-prior-dead" }],
          ["japan", { tool: "opencode", cwd: runDir }],
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

      cycle(deps) // t=0: both units resume-spawn; the stale id books on france's row verbatim
      // ADAPTED AT ADOPTION (gate-r26, the momentum-34 r19 precedent):
      // the original premise read the stale id through
      // rail.bookedSessionOf — the oracle the fix itself changes. The
      // mechanism premise (the resume books the PRIOR id verbatim,
      // without resolving it) is pinned on the RAW ROW; the oracle's
      // answer is now the fix's own shape: a dead pointer is not
      // boarding evidence.
      const franceRow = (ledger as { job: { panes: Array<{ unit: string; transcript?: { session_id?: string } }> } }).job.panes.find(
        (p) => p.unit === "w-france",
      )
      assert.equal(
        franceRow?.transcript?.session_id,
        "ses-prior-dead",
        "premise: the resume booked the PRIOR run's session id on france's row without resolving it",
      )
      assert.equal(
        rail.bookedSessionOf("france"),
        undefined,
        "the fixed oracle: a booked pointer whose session exists in NO store is not boarding evidence",
      )
      assert.equal(rail.bookedSessionOf("japan"), undefined, "premise: japan's unbooked pointer books no session")

      clock = 1_500 // past bornMs (1s): the birth judge's armed look
      cycle(deps)

      // the control: an unbooked, never-boarded resumed pane IS ruled on
      const reborn = events.filter((e) => e.kind === "unit.reborn").map((e) => e.payload.unit)
      assert.ok(
        reborn.includes("japan"),
        `control: the judge rules on an unbooked never-boarded resumed pane (unit.reborn events: ${JSON.stringify(events.filter((e) => e.kind === "unit.reborn"))})`,
      )

      // THE LAW: the stale predecessor's booking is not boarding evidence
      // for THIS pane — session existence is the only key, and ses-prior-dead
      // exists nowhere
      assert.ok(
        reborn.includes("france"),
        `INV-4 (the birth judge's own law — "Session existence is the only key" — is enforced as "a booked pointer exists", and on the ADR-5 continue arc that pointer is the PRIOR run's booking, booked verbatim by rail.resumeWorker → inhabitPane without resolving it): ` +
          `the france pane never boarded — the fake host start succeeded (the j-4a0009 modal class) and no session landed, and ses-prior-dead resolves in NO store (the host DB is empty; the judge's own rebook consults the store and finds nothing) — yet the judge SPARED it on the dead predecessor's id: bookedSessionOf("france") answered ${JSON.stringify(rail.bookedSessionOf("france"))} and the judge returned none before ever consulting the store. ` +
          `unit.reborn events: ${JSON.stringify(events.filter((e) => e.kind === "unit.reborn"))}. born_ms never fires for this pane: it rides the full stall ceiling (30 min on the pr-review template — the exact j-4a0009 ride born_ms exists to cut, on the continue arc this diff itself wires), and the fault lane acts on the same dead id. ` +
          `The control (japan, pointer unbooked) was ruled at the same beat — only the stale booking defeats the judge.`,
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
      rmSync(units, { recursive: true, force: true })
      rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    }
  })
}
