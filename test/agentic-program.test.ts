import assert from "node:assert/strict"
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { Dag } from "../src/dag.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-toys-"))

const { prepareRun } = await import("../src/run.ts")
const { loadDagFile, tick } = await import("../src/dag.ts")
const { loadManifest, runCounts, runGrade, runSignalDetector, runEndDetector, runGateDetector } = await import("../src/hooks.ts")
const { readSignal, endOf } = await import("../src/live-run.ts")
const { abortJob } = await import("../src/store.ts")

const PROG = join(import.meta.dirname, "..", "examples", "agentic-program")

type Unit = { id: string; brief: string }
type End = { id: string; end: string | null }

type World = {
  onStart?(dir: string): void
  onBirthActor?(dir: string): void
  onWave?(dir: string, units: Unit[]): void
  onPrompt?(dir: string, ends: End[]): void
  onBeat?(dir: string, beat: number, view: { waveClosed: boolean; graded: string[] }): void
}

// one full life of one toy program, through the real door, the real
// staged detectors and hooks, and the real tick — the harness only
// plays the world: the professor's pen, the students' keyboards, the
// human's verdict files
function driveLife(name: string, world: World): { dir: string; dag: Dag; rows: { unit: string; result: string; pass: boolean }[]; beats: number } {
  const src = mkdtempSync(join(tmpdir(), `toy-${name}-`))
  cpSync(join(PROG, name), src, { recursive: true })
  const booked = prepareRun(src)
  assert.equal(booked.ok, true, booked.ok ? "" : booked.why)
  if (!booked.ok) throw new Error(booked.why)
  const dir = booked.job.dir
  const dag = loadDagFile(join(dir, "dag.mjs"))
  const manifest = loadManifest(dir)
  world.onStart?.(dir)

  const done = new Set<string>()
  const graded = new Map<string, { pass: boolean; row: string }>()
  const finished: { unit: string; result: string; pass: boolean }[] = []
  const born = new Map<string, number>()
  const closed = new Set<string>()
  let actorBorn = false
  let openedWave = ""
  let prompted = false
  let reported = false
  let reopened = false
  let beats = 0
  for (; beats < 60 && !reported; beats++) {
    reopened = false
    const signal = manifest.detectors?.signal
      ? runSignalDetector(dir, manifest)
      : readSignal(dir)
    const ends: End[] = [...born].map(([id, at]) => {
      const end = manifest.detectors?.end
        ? runEndDetector(dir, manifest, id)
        : endOf(readFileSync(join(dir, "units", id, "log.txt"), "utf8"), id, true, 0)
      return { id, end }
    })
    const waveClosed = ends.length > 0 && ends.every((row) => row.end !== null)
    world.onBeat?.(dir, beats, { waveClosed, graded: [...graded.keys()] })
    const gatesReady: string[] = []
    for (const step of dag.steps.filter((s) => s.does === "gate")) {
      if (done.has(step.id) || !step.after.every((id) => done.has(id))) continue
      if (runGateDetector(dir, manifest, step.id)) gatesReady.push(step.id)
    }
    const actions = tick(dag, {
      done: [...done],
      actorBorn,
      signal: signal.kind,
      waveKey: signal.kind === "wave" ? signal.wave.units.map((u) => u.id).join(",") : "",
      openedWave,
      ends,
      graded: [...graded.keys()],
      prompted,
      gatesReady,
    })
    for (const action of actions) {
      if (action.do === "birth-actor") {
        actorBorn = true
        world.onBirthActor?.(dir)
      } else if (action.do === "birth-wave" && signal.kind === "wave") {
        for (const unit of signal.wave.units) {
          if (born.has(unit.id)) continue
          mkdirSync(join(dir, "units", unit.id), { recursive: true })
          born.set(unit.id, Date.now())
        }
        openedWave = signal.wave.units.map((u) => u.id).join(",")
        world.onWave?.(dir, signal.wave.units)
      } else if (action.do === "grade") {
        graded.set(action.id, runGrade(dir, manifest, { id: action.id, brief: "" }))
      } else if (action.do === "prompt-actor") {
        prompted = true
        world.onPrompt?.(dir, ends)
      } else if (action.do === "finish") {
        done.add(action.id)
      } else if (action.do === "reopen") {
        for (const id of action.ids) done.delete(id)
        born.clear()
        graded.clear()
        closed.clear()
        prompted = false
        reopened = true
      } else if (action.do === "report") {
        reported = true
      }
    }
    if (reopened) continue // the rail skips the finish pass on a reopen beat
    for (const row of ends) {
      if (row.end !== "done" || closed.has(row.id)) continue
      closed.add(row.id)
      finished.push({
        unit: row.id,
        result: graded.get(row.id)?.row ?? "done",
        pass: graded.has(row.id) ? graded.get(row.id).pass : true,
      })
    }
  }
  assert.equal(reported, true, `${name}: the run must reach its report`)
  abortJob(booked.job, "test", 0, "cli")
  return { dir, dag, rows: finished, beats }
}

function writeProtocol(dir: string, units: Unit[]): void {
  writeFileSync(join(dir, "protocol.json"), JSON.stringify({ units }))
}

function unit(id: string, question: string): Unit {
  return { id, brief: `Answer in <=10 words, quoting data/source.md: ${question}` }
}

function student(dir: string, id: string, answer: string): void {
  const home = join(dir, "units", id)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, "result.md"), `${answer}\n`)
  appendFileSync(join(home, "log.txt"), `done ${id}\n`)
}

test("trivia-bench: rounds retarget a miss and score the agent", () => {
  let round = 0
  const life = driveLife("trivia-bench", {
    onBirthActor(dir) {
      round = 1
      writeFileSync(join(dir, "key.json"), JSON.stringify({
        q1: "Aurora A3",
        q2: "32 hours",
        q3: "Bluetooth 5.3",
      }))
      writeProtocol(dir, [
        unit("q1", "What is the model name of the current Aurora alarm clock?"),
        unit("q2", "How long does the battery last with the display on?"),
        unit("q3", "Which Bluetooth version does the A3 have?"),
      ])
    },
    onWave(dir, units) {
      const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"))
      for (const u of units) {
        const wrong = round === 1 && u.id === "q3"
        student(dir, u.id, wrong ? "Wi-Fi 6" : key[u.id])
      }
    },
    onPrompt(dir) {
      if (round === 1) {
        round = 2
        writeFileSync(join(dir, "key.json"), JSON.stringify({
          q4: "3 per alarm",
          q5: "78 dB",
        }))
        writeProtocol(dir, [
          unit("q4", "How many snoozes are allowed per alarm?"),
          unit("q5", "How loud is the ringer at one meter?"),
        ])
      } else {
        writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))
      }
    },
  })
  assert.equal(existsSync(join(life.dir, "data", "source.md")), true)
  const manifest = loadManifest(life.dir)
  const counts = runCounts(life.dir, manifest, life.rows)
  assert.deepEqual(counts, { questions: 5, right: 4, wrong: 1, score: 80 })
  assert.equal(life.rows.find((r) => r.unit === "q3")?.pass, false)
})

test("inbox-zero: a rejection requeues through the world and the report waits for the human", () => {
  let phase = 0
  const life = driveLife("inbox-zero", {
    onStart(dir) {
      cpSync(join(dir, "data", "inbox"), join(dir, "inbox"), { recursive: true })
    },
    onWave(dir, units) {
      for (const u of units) {
        const home = join(dir, "units", u.id)
        mkdirSync(home, { recursive: true })
        const redraft = existsSync(join(home, "reply.md"))
        writeFileSync(join(home, "reply.md"), `Regarding ${u.id}: ${redraft ? "second draft — " : ""}we will make this right.\n`)
        writeFileSync(join(home, "reply-sent"), "")
      }
    },
    onBeat(dir, beat, view) {
      void beat
      // the human's sequence: reject -> (gate applies it, signal re-offers,
      // rail reopens) -> redraft graded -> approve
      if (phase === 0 && view.waveClosed && view.graded.length >= 3) {
        phase = 1
        writeFileSync(join(dir, "inbox", "verdict.json"), JSON.stringify({ reject: ["t42-snooze"] }))
      } else if (phase === 1 && !existsSync(join(dir, "inbox", "verdict.json"))) {
        phase = 2 // the gate consumed the verdict
      } else if (phase === 2 && !view.graded.includes("t42-snooze")) {
        phase = 3 // the reopen cleared the old generation
      } else if (phase === 3 && view.waveClosed && view.graded.includes("t42-snooze")) {
        phase = 4
        writeFileSync(join(dir, "inbox", "verdict.json"), JSON.stringify({ approve: true }))
      }
    },
  })
  assert.equal(existsSync(join(life.dir, "units", "t42-snooze", "reply-sent")), true)
  assert.match(readFileSync(join(life.dir, "units", "t42-snooze", "reply.md"), "utf8"), /second draft/)
  assert.equal(readdirSync(join(life.dir, "inbox", "verdicts")).length, 2)
  const counts = runCounts(life.dir, loadManifest(life.dir), life.rows)
  assert.deepEqual(counts, { tickets: 3, replied: 3, failed: 0 })
})

test("two-signoffs: the report waits for both independent gates", () => {
  let secAt: number | null = null
  const sections = readFileSync(join(PROG, "two-signoffs", "data", "sections.md"), "utf8").split(/\n---+\n/)
  const life = driveLife("two-signoffs", {
    onBirthActor(dir) {
      const units: Unit[] = []
      for (let s = 1; s <= 2; s++) {
        for (const lang of ["de", "ja"]) {
          units.push({
            id: `s${s}-${lang}`,
            brief: `Translate this timeline section to ${lang}. Preserve markdown headings and times.\n${sections[s - 1]}`,
          })
        }
      }
      writeProtocol(dir, units)
    },
    onWave(dir, units) {
      for (const u of units) {
        const home = join(dir, "units", u.id)
        mkdirSync(home, { recursive: true })
        writeFileSync(join(home, "draft.md"), `${u.brief}\n`)
        appendFileSync(join(home, "log.txt"), `done ${u.id}\n`)
      }
    },
    onPrompt(dir) {
      writeFileSync(join(dir, "protocol.json"), JSON.stringify({ stop: true }))
    },
    onBeat(dir, beat, view) {
      if (secAt === null && view.waveClosed) secAt = beat
      if (secAt !== null && beat === secAt + 2) {
        mkdirSync(join(dir, "signoffs"), { recursive: true })
        writeFileSync(join(dir, "signoffs", "security.md"), "no internal hosts leaked\n")
      }
      if (secAt !== null && beat === secAt + 4) {
        mkdirSync(join(dir, "signoffs"), { recursive: true })
        writeFileSync(join(dir, "signoffs", "legal.md"), "no liability admitted\n")
      }
    },
  })
  assert.equal(existsSync(join(life.dir, "signoffs", "security.md")), true)
  assert.equal(existsSync(join(life.dir, "signoffs", "legal.md")), true)
  const counts = runCounts(life.dir, loadManifest(life.dir), life.rows)
  assert.deepEqual(counts, { sections: 4, delivered: 4 })
})
