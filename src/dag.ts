import { readFileSync } from "node:fs"

// A lab program is one file that names steps. This module is the only
// scheduler: it reads that file and says which step is ready. The file
// is not executed, so it cannot start a second scheduler.

export type StepDoes = "actor" | "wave" | "grade" | "report"

export type Step = {
  id: string
  does: StepDoes
  after: string[]
}

export type Dag = {
  name: string
  steps: Step[]
}

const VERBS = new Set<StepDoes>(["actor", "wave", "grade", "report"])

const SCHEDULER = /fan-out-orchestrator|child_process|\bwhile\b|\bspawn\b|setInterval|setTimeout|\bscheduler\b/

export function assertProgram(source: string): void {
  if (SCHEDULER.test(source)) throw new Error("a program does not schedule")
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
  if (/\(/.test(code)) throw new Error("a program names steps; it does not call")
}

function toJson(objectLiteral: string): string {
  return objectLiteral
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1")
}

export function parseDag(source: string): Dag {
  assertProgram(source)
  const matched = source.match(/export\s+const\s+dag\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)
  if (!matched) throw new Error("a program is export const dag = { ... }")
  let raw: unknown
  try {
    raw = JSON.parse(toJson(matched[1]))
  } catch (err) {
    throw new Error(`dag file is not a step list: ${err instanceof Error ? err.message : err}`)
  }
  if (!raw || typeof raw !== "object") throw new Error("dag file is not a step list")
  const name = (raw as { name?: unknown }).name
  const steps = (raw as { steps?: unknown }).steps
  if (typeof name !== "string" || !name.trim()) throw new Error("dag.name is required")
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("dag.steps is required")
  const parsed: Step[] = []
  const ids = new Set<string>()
  for (const step of steps) {
    if (!step || typeof step !== "object") throw new Error("a step needs an id")
    const id = (step as { id?: unknown }).id
    const does = (step as { does?: unknown }).does
    const afterRaw = (step as { after?: unknown }).after
    if (typeof id !== "string" || !id.trim()) throw new Error("a step needs an id")
    if (ids.has(id)) throw new Error(`duplicate step: ${id}`)
    ids.add(id)
    if (typeof does !== "string" || !VERBS.has(does as StepDoes)) throw new Error(`unknown step: ${String(does)}`)
    const after = afterRaw === undefined ? [] : Array.isArray(afterRaw) ? afterRaw : [afterRaw]
    if (after.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`step ${id} has a bad after`)
    parsed.push({ id, does: does as StepDoes, after })
  }
  for (const step of parsed) {
    for (const need of step.after) {
      if (!ids.has(need)) throw new Error(`step ${step.id} needs missing step ${need}`)
    }
  }
  const dag = { name, steps: parsed }
  order(dag)
  return dag
}

export function loadDagFile(path: string): Dag {
  return parseDag(readFileSync(path, "utf8"))
}

export function ready(dag: Dag, done: ReadonlySet<string>): Step[] {
  return dag.steps.filter((step) => !done.has(step.id) && step.after.every((id) => done.has(id)))
}

export function order(dag: Dag): string[] {
  const done = new Set<string>()
  const out: string[] = []
  while (out.length < dag.steps.length) {
    const batch = ready(dag, done)
    if (batch.length === 0) throw new Error("dag is cyclic")
    for (const step of batch) {
      done.add(step.id)
      out.push(step.id)
    }
  }
  return out
}

export type SignalKind = "missing" | "partial" | "stop" | "wave"

export type TickIn = {
  done: string[]
  actorBorn: boolean
  signal: SignalKind
  waveKey: string
  openedWave: string
  ends: { id: string; end: string | null }[]
  graded: string[]
  prompted: boolean
}

export type TickAction =
  | { do: "birth-actor" }
  | { do: "birth-wave" }
  | { do: "grade"; id: string }
  | { do: "prompt-actor" }
  | { do: "report" }
  | { do: "finish"; id: string }
  | { do: "reopen"; ids: string[] }

function byDoes(dag: Dag, does: StepDoes): Step | undefined {
  return dag.steps.find((step) => step.does === does)
}

function depsDone(step: Step | undefined, done: Set<string>): boolean {
  return !!step && step.after.every((id) => done.has(id))
}

export function tick(dag: Dag, state: TickIn): TickAction[] {
  const done = new Set(state.done)
  const actions: TickAction[] = []
  const actor = byDoes(dag, "actor")
  const wave = byDoes(dag, "wave")
  const grade = byDoes(dag, "grade")
  const report = byDoes(dag, "report")

  if (
    wave &&
    done.has(wave.id) &&
    state.signal === "wave" &&
    state.waveKey !== "" &&
    state.waveKey !== state.openedWave
  ) {
    const ids = [wave.id, grade?.id].filter((id): id is string => !!id && done.has(id))
    if (ids.length > 0) return [{ do: "reopen", ids }]
  }

  const finish = (step: Step | undefined) => {
    if (!step || done.has(step.id)) return
    actions.push({ do: "finish", id: step.id })
    done.add(step.id)
  }

  if (state.signal === "stop") {
    finish(actor)
    finish(wave)
    finish(grade)
  }

  if (actor && !done.has(actor.id)) {
    if (!state.actorBorn && state.signal !== "stop") actions.push({ do: "birth-actor" })
    if (state.signal === "wave") finish(actor)
  }

  const waveClosed = state.ends.length > 0 && state.ends.every((row) => row.end !== null)
  if (wave && !done.has(wave.id) && (actor ? done.has(actor.id) : true) && state.signal === "wave") {
    actions.push({ do: "birth-wave" })
    if (waveClosed) finish(wave)
  }

  if (grade && !done.has(grade.id) && depsDone(grade, done)) {
    for (const row of state.ends) {
      if (row.end === "done" && !state.graded.includes(row.id)) actions.push({ do: "grade", id: row.id })
    }
    const finished = state.ends.filter((row) => row.end === "done").every((row) => state.graded.includes(row.id))
    if (waveClosed && finished) finish(grade)
  }

  const upstreamDone = (step: Step | undefined) => !!step && step.after.every((id) => done.has(id))
  // the actor is re-prompted only when grading has settled: with a grade
  // step, after it finished (every done end graded); without one, after
  // the wave closed.
  const gradeSettled = grade ? done.has(grade.id) : upstreamDone(wave)
  if (
    actor &&
    waveClosed &&
    state.signal === "wave" &&
    !state.prompted &&
    gradeSettled
  ) {
    actions.push({ do: "prompt-actor" })
  }

  if (report && !done.has(report.id) && upstreamDone(report) && (state.signal === "stop" || !actor)) {
    actions.push({ do: "report" })
  }
  return actions
}
