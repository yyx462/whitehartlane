// The lab engine (moved out of bin/lab-orchestrator so tests can reach
// it — the bin is only the door). A professor pane, then student panes.
// A lab program is one dag file; when it is staged beside the run, the
// file is the scheduler's input — read, never executed. The engine
// drives the Rail: births panes, grades, relays wave closes to the
// actor, answers permission dialogs, and writes the report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { withBackpressure } from "./backpressure.ts"
import { loadDagFile, tick } from "./dag.ts"
import { runCounts, runEndDetector, runGateDetector, runGrade, runSignalDetector } from "./hooks.ts"
import { emptyBoard } from "./lanes.ts"
import { endOf, readSignal, wakesFor, waveClosed } from "./live-run.ts"
import { gradeCall } from "./live-grade.ts"
import { actorBrief, orchestratorBrief, paneName } from "./roles.ts"
import { writeReport, type Report } from "./report.ts"
import { waitChange, type Rail } from "./rail.ts"
import { writeWorkerPermissions } from "./store.ts"
import { closes } from "./verbose.ts"

export async function runLab(rail: Rail): Promise<Report | null> {
  const taskDir = rail.taskDir
  const log = rail.log
  let jobText = ""
  try { jobText = readFileSync(join(taskDir, "actor.md"), "utf8") } catch {}
  // A lab program is one dag file. When it is staged beside this run,
  // the file is the scheduler's input: tick() decides every birth,
  // grade, prompt, and reopen. No second scheduler exists — the file
  // is read, never executed.
  const dag = (() => {
    try {
      return loadDagFile(join(taskDir, "dag.mjs"))
    } catch {
      return null
    }
  })()
  // Detectors: the program's say in what a wave or an end is. Absent,
  // the OS defaults (protocol.json, log.txt) run — a detector may
  // slow or fail, never kill the rail: refusal retries, deterministic
  // failure degrades and logs once.
  const manifestEarly = (() => {
    try {
      return rail.manifest()
    } catch {
      return null
    }
  })()
  const detectors = manifestEarly?.detectors
  const gateSteps = dag ? dag.steps.filter((s) => s.does === "gate") : []
  const gateMissed = gateSteps.filter((s) => !manifestEarly?.gates?.[s.id])
  if (gateMissed.length > 0) {
    throw new Error(`gate step ${gateMissed.map((s) => s.id).join(", ")} has no [gates] detector — refusing`)
  }
  const saidDetectorFailure = new Set<string>()
  function detectorCall<T>(what: string, fn: () => T, fallback: T): T {
    try {
      return withBackpressure(fn, { who: what, log })
    } catch (err) {
      const line = `${what} failed: ${err && err instanceof Error ? err.message : String(err)}`
      if (!saidDetectorFailure.has(line)) {
        saidDetectorFailure.add(line)
        log(line)
      }
      return fallback
    }
  }
  let board = emptyBoard()
  if (rail.wantVerbose()) rail.openVerbose()
  mkdirSync(join(taskDir, "briefs"), { recursive: true })
  const orchPath = join(taskDir, "briefs", "orchestrator.md")
  writeFileSync(orchPath, orchestratorBrief())
  const orch = rail.ensureRole(board, "orchestrator", taskDir)
  board = orch.board
  if (orch.pane && rail.inhabitPane("orchestrator", "pi", orch.pane, orchPath, taskDir)) {
    rail.renamePane(orch.pane, "orchestrator")
    log(`name orchestrator pane ${orch.pane}`)
    rail.say("rail", "birth orchestrator")
  } else {
    log("orchestrator pane failed")
  }
  const actorPath = join(taskDir, "briefs", "actor.md")
  writeFileSync(actorPath, actorBrief(jobText))
  const born = new Map<string, number>()
  const mockPane = new Map<string, string>()
  const closed = new Set<string>()
  const graded = new Map<string, { pass: boolean; row: string }>()
  const woke: string[] = []
  const settled: { unit: string; result: string; pass: boolean }[] = []
  let prompted = ""
  const kind = (() => {
    try {
      return readFileSync(join(taskDir, "workflow.toml"), "utf8").match(/worker_kind\s*=\s*"([^"]+)"/)?.[1] ?? "opencode"
    } catch {
      return "opencode"
    }
  })()

  function mockEnd(id: string, spawnedAt: number) {
    const logPath = join(taskDir, "units", id, "log.txt")
    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    return endOf(logText, id, rail.paneAlive(paneName("mock", id)), Date.now() - spawnedAt)
  }

  function spawnWave(units: { id: string; brief: string }[]) {
    for (const unit of units) {
      if (born.has(unit.id)) continue
      const dir = join(taskDir, "units", unit.id)
      mkdirSync(dir, { recursive: true })
      const briefPath = join(dir, "brief.md")
      const name = paneName("mock", unit.id)
      writeFileSync(briefPath, [
        unit.brief,
        "",
        "When you finish, append exactly this line to the log file",
        `${join(dir, "log.txt")} :`,
        `done ${unit.id}`,
        "",
        "If you cannot proceed, append exactly this line and stop:",
        `blocked ${unit.id}: <why>`,
        "",
        `Write what you generated to ${join(dir, "result.md")}`,
      ].join("\n"))
      writeWorkerPermissions(dir, [taskDir, ...rail.programRoots])
      const slot = rail.ensureRole(board, "mock", dir)
      board = slot.board
      const ok = slot.pane ? rail.inhabitPane(name, kind, slot.pane, briefPath, dir) : false
      if (slot.pane) rail.renamePane(slot.pane, name)
      born.set(unit.id, Date.now())
      if (slot.pane) mockPane.set(unit.id, slot.pane)
      log(ok ? `name ${name} pane ${slot.pane}` : `mock ${name} failed to spawn`)
      if (ok) rail.say("rail", `birth ${name}`)
    }
  }

  function gradeUnit(id: string) {
    try {
      graded.set(id, runGrade(taskDir, rail.manifest(), { id, brief: "" }))
      rail.say("rail", `grade ${paneName("mock", id)}`)
    } catch (err) {
      graded.set(id, { pass: false, row: "fail grade" })
      log(`grade ${id} failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  function promptActor(ends: { id: string; end: string | null }[]) {
    rail.promptAgent("actor", [
      "Wave closed.",
      ...ends.map((row) => `${paneName("mock", row.id)}: ${row.end}`),
      "Results are under units/.",
      "Write the next protocol.json, or {\"stop\":true}.",
    ].join("\n"))
    log("prompted actor")
    rail.say("rail", "prompt actor")
  }

  function birthActor() {
    const actor = rail.ensureRole(board, "actor", taskDir)
    board = actor.board
    if (actor.pane && rail.inhabitPane("actor", "pi", actor.pane, actorPath, taskDir)) {
      rail.renamePane(actor.pane, "actor")
      log(`name actor pane ${actor.pane}`)
      rail.say("rail", "birth actor")
    } else {
      log("actor pane failed")
    }
  }

  // dag drives the actor's birth; a workflow.toml lab births it here
  if (!dag) birthActor()

  const done = new Set<string>()
  let actorBorn = !!dag ? false : true
  let openedWave = ""
  let promptedDag = false
  const deadline = Date.now() + 2 * 60 * 60_000
  while (Date.now() < deadline) {
    const signal = detectors?.signal
      ? detectorCall("signal detector", () => runSignalDetector(taskDir, manifestEarly), { kind: "missing" })
      : readSignal(taskDir)
    const ends = [...born].map(([id, at]) => {
      let end = detectors?.end
        ? detectorCall(`end detector ${id}`, () => runEndDetector(taskDir, manifestEarly, id), null)
        : mockEnd(id, at)
      // liveness stays rail-owned: a dead pane is dead even under a
      // custom end detector, and herdr still names the blocked
      if (!end && Date.now() - at > 15_000 && !rail.paneAlive(paneName("mock", id))) end = "dead"
      if (!end && rail.agentStatus(paneName("mock", id)).includes('"agent_status":"blocked"')) {
        end = "blocked"
      }
      return { id, end }
    })
    const gatesReady: string[] = []
    for (const step of gateSteps) {
      if (done.has(step.id) || !step.after.every((id) => done.has(id))) continue
      const ready = detectorCall(`gate ${step.id}`, () => runGateDetector(taskDir, manifestEarly, step.id), false)
      if (ready) {
        gatesReady.push(step.id)
        rail.say("rail", `gate ${step.id} ready`)
      }
    }
    let stopNow = false
    let reopened = false
    if (dag) {
      const waveKey = signal.kind === "wave" ? signal.wave.units.map((unit) => unit.id).join(",") : ""
      const actions = tick(dag, {
        done: [...done],
        actorBorn,
        signal: signal.kind,
        waveKey,
        openedWave,
        ends,
        graded: [...graded.keys()],
        prompted: promptedDag,
        gatesReady,
      })
      for (const action of actions) {
        if (action.do === "birth-actor") {
          birthActor()
          actorBorn = true
        } else if (action.do === "birth-wave") {
          if (signal.kind === "wave") {
            spawnWave(signal.wave.units)
            openedWave = waveKey
          }
        } else if (action.do === "grade") {
          gradeUnit(action.id)
        } else if (action.do === "prompt-actor") {
          promptActor(ends)
          promptedDag = true
        } else if (action.do === "finish") {
          done.add(action.id)
        } else if (action.do === "reopen") {
          for (const id of action.ids) done.delete(id)
          born.clear()
          mockPane.clear()
          closed.clear()
          graded.clear()
          promptedDag = false
          reopened = true
          rail.say("rail", `reopen ${action.ids.join(", ")}`)
        } else if (action.do === "report") {
          stopNow = true
        }
      }
      if (stopNow || signal.kind === "stop") break
    } else {
      if (signal.kind === "stop") break
      if (signal.kind === "wave") spawnWave(signal.wave.units)
    }
    for (const id of wakesFor(ends, woke)) {
      // Privilege (zen 6): a blocked mock is first a question for the
      // typed decider — answer the dialog; only a capped or genuinely
      // non-dialog block wakes the orchestrator pane (the mind). The
      // id joins `woke` only on a real wake, so a fresh dialog on the
      // same pane is answered again next beat.
      const verdict = rail.answerPermission(paneName("mock", id))
      if (verdict === "allow" || verdict === "deny") {
        log(`answered permission for ${paneName("mock", id)} (${verdict}) — no orchestrator wake`)
        continue
      }
      woke.push(id)
      rail.promptAgent("orchestrator", `${paneName("mock", id)} is blocked: waiting for a permission or a decision. Name that pane. Do not spawn.`)
      log(`wake orchestrator ${paneName("mock", id)} blocked`)
      rail.say("watcher", `${paneName("mock", id)} blocked`)
      rail.say("rail", `prompt orchestrator ${paneName("mock", id)}`)
    }
    if (reopened) {
      await waitChange(taskDir, 30_000)
      continue
    }
    for (const row of ends) {
      if (!dag && gradeCall(row.end, graded.has(row.id))) gradeUnit(row.id)
      if (!closes(row.end) || closed.has(row.id)) continue
      const pane = mockPane.get(row.id)
      const name = paneName("mock", row.id)
      closed.add(row.id)
      settled.push({
        unit: row.id,
        result: graded.get(row.id)?.row ?? row.end ?? "open",
        pass: graded.has(row.id) ? graded.get(row.id)!.pass : row.end === "done",
      })
      if (pane) {
        rail.closePane(pane)
        rail.retire(name)
        board = rail.dropPane(board, pane)
      }
      rail.say("operator", `close ${name}`)
    }
    if (!dag && waveClosed(ends)) {
      const mark = ends.map((row) => row.end).join(",")
      if (prompted !== mark) {
        prompted = mark
        promptActor(ends)
      }
    }
    await waitChange(taskDir, 30_000)
  }
  const finalEnds = [...born].map(([id, at]) => ({ id, end: mockEnd(id, at) }))
  const rows = dag
    ? [...settled, ...finalEnds
        .filter((row) => !closes(row.end))
        .map((row) => ({ unit: row.id, result: row.end ?? "open", pass: row.end === "done" }))]
    : finalEnds.map((row) => {
        const grade = graded.get(row.id)
        return { unit: row.id, result: grade?.row ?? row.end ?? "open", pass: grade ? grade.pass : row.end === "done" }
      })
  const stopped = readSignal(taskDir).kind === "stop"
  const report = writeReport(
    taskDir,
    taskDir,
    rows,
    (table) => runCounts(taskDir, rail.manifest(), table),
    stopped && rows.every((row) => row.pass) ? "done" : rows.length === 0 && stopped ? "done" : undefined,
  )
  rail.retireAll()
  rail.closeVerbose()
  return report
}
