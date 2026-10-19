import { execSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"
import { RefusedError } from "./backpressure.ts"
import { parseSignal, type LiveSignal } from "./live-run.ts"

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export type Unit = { id: string; brief: string }

export type Grade = { pass: boolean; row: string; fault?: "grade-fault" }

export type Hooks = {
  units: () => Unit[]
  grade: (unit: Unit) => Grade
  counts: (rows: CountRow[]) => Record<string, number>
  workerKind: "opencode" | "pi" | "mock"
}

// A scorecard row (issue #120): `pass` rides along so a counts hook —
// and the built-in counter — can count outcomes, not just rows. The
// scaffold's old shell counter filtered x.pass on a table.json that
// never carried it (always 0 passed); the typed counter ends that.
export type CountRow = { unit: string; result: string; pass: boolean }

// The built-in counter (issue #120): what a program gets when it omits
// hooks.counts or says counts = "default". The old trap: hooks were
// required fields, the scaffold taught units/grade = "true" as the
// no-op spelling, and authors copied the token to counts — where the
// contract (print a JSON object of numbers) makes /bin/true a
// deterministic report-time fatal (j-64e035: 79 minutes of work, then
// aborted by an empty stdout).
export function builtinCounts(rows: CountRow[]): Record<string, number> {
  return {
    units: rows.length,
    passed: rows.filter((r) => r.pass).length,
    failed: rows.filter((r) => !r.pass).length,
  }
}

export type Layout = {
  tab: "same" | "new"
  orchestrator: "left" | "right"
}

// ADR 0007 — finish-typed steps. A step is a topology node typed by the
// signal that finished_by it: end (a worker's log), check (a command exits
// 0 — nothing works on it), wake (a child job's receipt). Waves are
// grouping, not steps; the report is the epilogue after the last wave.
// ADR 0014: steps are the compilation target of [[stage]] ONLY — the
// raw [[step]] dialect is refused at parse.
export type Step = {
  id: string
  finished_by: "end" | "check" | "wake" | "gate"
  wave: string
  brief?: string
  check?: string
  folder?: string
}

// Issue #152 slice 1 — stage-first workflows. A workflow may declare
// [[stage]] tables: the CHAIN (table order = execution order), each
// stage with its own topology and its own hooks. "split" is dead by
// design review (2026-10-18): ordering is the workflow's job, never a
// node's — what split used to express is a chain of solo stages, and
// every unit is a fresh worker session either way (continuity is the
// shared task container, which the chain keeps). Grade binding rides
// the plan (#150): verify.sh fires only where a stage says so.
export type StageMember = {
  name: string
  brief: string
  initiates?: boolean
  model?: string
}

export type Stage = {
  id: string
  topology: "solo" | "fan-out" | "coworker" | "gate" | "lab"
  brief?: string
  units?: { id: string; brief: string; model?: string }[]
  members?: StageMember[]
  model?: string
  check?: string
  run?: string
  grade?: boolean
  signal?: string
  end?: string
  preamble?: string
}

// Per-unit grade binding compiled from stages: "task" = the task-level
// [hooks] grade (verify.sh); "check" = the unit's OWN stage check, never
// the task verifier; "none" = the stage declared no hook — the worker's
// done is the unit's word, grading belongs to a later stage's gate.
export type GradePlan = { grade: "task" | "check" | "none"; check?: string }

function stagesFromRaw(raw: unknown): Stage[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new HookError("stages must be an array of [[stage]] tables")
  const stages: Stage[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const t = entry as Record<string, unknown>
    const id = str(t.id, "stage.id")
    if (!SHEP_SAFE_ID.test(id)) throw new HookError(`stage id is not shep-safe: ${id}`)
    if (seen.has(id)) throw new HookError(`stage repeats id ${id}`)
    seen.add(id)
    const topology = str(t.topology, `stage ${id} topology`)
    if (
      topology !== "solo" && topology !== "fan-out" && topology !== "coworker" &&
      topology !== "gate" && topology !== "lab"
    ) {
      throw new HookError(
        `stage ${id} topology must be solo, fan-out, coworker, gate, or lab (issue #152; "split" is dead — order the chain with stages): ${topology}`,
      )
    }
    const cmd = (value: unknown, field: string): string | undefined => {
      if (value === undefined) return undefined
      if (typeof value !== "string" || value.length === 0) {
        throw new HookError(`${field} must be a command string: ${String(value)}`)
      }
      return value
    }
    // a pin validates like [workflow] model: provider/model, no spaces
    const modelStr = (value: unknown, field: string): string => {
      const m = str(value, field)
      if (!/^[^/\s]+\/[^/\s]+$/.test(m)) throw new HookError(`${field} must be provider/model: ${m}`)
      return m
    }
    if (topology === "coworker") {
      // the exchange, as one chain link: members are minted into a
      // CHILD coworker program (stages/<id>/workflow.toml) and the
      // wake machinery levies it once at the frontier — the child's
      // wake receipt settles the stage like any wake step
      if (!Array.isArray(t.members) || t.members.length < 2) {
        throw new HookError(
          `stage ${id} is topology coworker: members must be an array of at least two {name, brief, initiates} tables`,
        )
      }
      let initiates = 0
      const names = new Set<string>()
      for (const [i, mem] of t.members.entries()) {
        const row = mem as Record<string, unknown>
        const name = str(row.name, `stage ${id} members[${i}].name`)
        if (!SHEP_SAFE_ID.test(name)) throw new HookError(`stage ${id} member name is not shep-safe: ${name}`)
        if (names.has(name)) throw new HookError(`stage ${id} member repeats name ${name}`)
        names.add(name)
        if (row.initiates === true) initiates += 1
        else if (row.initiates !== undefined && row.initiates !== false) {
          throw new HookError(`stage ${id} members[${i}].initiates must be true or false: ${String(row.initiates)}`)
        }
      }
      if (initiates !== 1) {
        throw new HookError(
          `stage ${id} is topology coworker: exactly one member must carry initiates = true (got ${initiates}) — otherwise everyone idles and the exchange never starts`,
        )
      }
      if (t.brief !== undefined) {
        throw new HookError(`stage ${id} is topology coworker: members carry their own briefs — stage-level brief does not apply`)
      }
      if (t.run !== undefined) {
        throw new HookError(`stage ${id} is topology coworker: run belongs to gate stages — the exchange is the members' work`)
      }
      if (t.units !== undefined) {
        throw new HookError(`stage ${id} is topology coworker: the members ARE the workers — units does not apply`)
      }
      if (t.grade !== undefined) {
        throw new HookError(
          `stage ${id} is topology coworker: grade does not apply — the task verifier binds to unit stages and gates, never to an exchange (check IS allowed: it runs after the child's wake, as the stage's own verdict on the members' joint output)`,
        )
      }
    }
    if (topology === "lab") {
      // the experiment, as one chain link: ONE mind — the actor —
      // whose brief is the stage's brief (the actor's job text), with
      // signal/end detectors observing instead of a done-protocol.
      // Delegates like coworker: minted as a child lab program
      // (kind = "lab"), levied once; the wake receipt + the stage's
      // check settle it.
      str(t.brief, `stage ${id} brief`)
      if (t.units !== undefined) {
        throw new HookError(`stage ${id} is topology lab: the actor composes its own waves at runtime — units does not apply`)
      }
      if (t.members !== undefined) {
        throw new HookError(`stage ${id} is topology lab: the actor directs mock waves — members does not apply`)
      }
      if (t.run !== undefined) {
        throw new HookError(`stage ${id} is topology lab: run belongs to gate stages — the actor is the workforce here`)
      }
      if (t.grade !== undefined) {
        throw new HookError(
          `stage ${id} is topology lab: grade does not apply — the task verifier binds to unit stages and gates, never to an experiment (check IS allowed: it runs after the child's wake)`,
        )
      }
      cmd(t.signal, `stage ${id} signal`)
      cmd(t.end, `stage ${id} end`)
    }
    if (topology !== "coworker" && topology !== "lab") {
      if (t.members !== undefined) {
        throw new HookError(`stage ${id} is topology ${topology}: members belong to coworker stages`)
      }
      if (topology === "gate" && t.model !== undefined) {
        throw new HookError(`stage ${id} is topology gate: no mind, no pin — gate stages run a command, not a worker`)
      }
    }
    if (topology !== "lab" && (t.signal !== undefined || t.end !== undefined)) {
      throw new HookError(`stage ${id} is topology ${topology}: signal/end detectors belong to lab stages`)
    }
    const stage: Stage = { id, topology }
    if (topology === "lab") {
      stage.brief = str(t.brief, `stage ${id} brief`)
      stage.signal = cmd(t.signal, `stage ${id} signal`)
      stage.end = cmd(t.end, `stage ${id} end`)
      if (t.model !== undefined) stage.model = modelStr(t.model, `stage ${id} model`)
    }
    if (topology === "coworker") {
      stage.members = (t.members as Record<string, unknown>[]).map((row) => {
        const member: StageMember = {
          name: row.name as string,
          brief: str(row.brief, `stage ${id} members[${row.name as string}].brief`),
        }
        if (row.initiates === true) member.initiates = true
        if (row.model !== undefined) member.model = str(row.model, `stage ${id} members[${row.name as string}].model`)
        return member
      })
      if (t.model !== undefined) stage.model = modelStr(t.model, `stage ${id} model`)
    }
    if (topology === "solo") {
      stage.brief = str(t.brief, `stage ${id} brief`)
      if (t.model !== undefined) stage.model = modelStr(t.model, `stage ${id} model`)
      if (t.units !== undefined) {
        throw new HookError(`stage ${id} is topology solo: units belong to fan-out stages — a solo stage's one worker takes brief`)
      }
    }
    if (topology === "fan-out") {
      if (t.brief !== undefined) {
        throw new HookError(`stage ${id} is topology fan-out: units carry their own briefs — stage-level brief does not apply`)
      }
      if (t.model !== undefined) stage.model = modelStr(t.model, `stage ${id} model`)
      if (!Array.isArray(t.units) || t.units.length === 0) {
        throw new HookError(`stage ${id} is topology fan-out: units must be a non-empty array of {id, brief} tables`)
      }
      stage.units = t.units.map((u, i) => {
        const row = u as Record<string, unknown>
        const uid = str(row.id, `stage ${id} units[${i}].id`)
        if (!SHEP_SAFE_ID.test(uid)) throw new HookError(`stage ${id} unit id is not shep-safe: ${uid}`)
        if (seen.has(uid)) throw new HookError(`stage unit repeats id ${uid}`)
        seen.add(uid)
        const unit: { id: string; brief: string; model?: string } = {
          id: uid,
          brief: str(row.brief, `stage ${id} units[${i}].brief`),
        }
        if (row.model !== undefined) unit.model = modelStr(row.model, `stage ${id} units[${i}].model`)
        return unit
      })
    }
    if (topology === "gate") {
      stage.run = cmd(t.run, `stage ${id} run`)
      const brief = cmd(t.brief, `stage ${id} brief`)
      if (brief !== undefined) throw new HookError(`stage ${id} is topology gate: it runs no worker — brief does not apply`)
    }
    if (topology === "solo" || topology === "fan-out" || topology === "coworker" || topology === "lab") {
      // the stage's own verdict hook: worker stages run it per finishing
      // unit; coworker/lab stages run it after the child's wake receipt
      stage.check = cmd(t.check, `stage ${id} check`)
      if (topology === "solo" || topology === "fan-out") {
        if (t.grade !== undefined) {
          if (typeof t.grade !== "boolean") throw new HookError(`stage ${id} grade must be true or false: ${String(t.grade)}`)
          stage.grade = t.grade
        }
        if (t.run !== undefined) {
          throw new HookError(`stage ${id} is topology ${topology}: run belongs to gate stages — declare check for this stage's own hook`)
        }
      }
    } else {
      for (const field of ["check", "grade", "units"] as const) {
        if (t[field] !== undefined) {
          throw new HookError(`stage ${id} is topology ${topology}: ${field} does not apply (gate stages declare run)`)
        }
      }
    }
    if (topology === "fan-out" || topology === "coworker") {
      // the roster's shared context, authored once: each mind's
      // effective brief = preamble + its own roster entry
      if (t.preamble !== undefined) stage.preamble = str(t.preamble, `stage ${id} preamble`)
    } else if (t.preamble !== undefined) {
      throw new HookError(
        `stage ${id} is topology ${topology}: preamble belongs to roster stages (fan-out, coworker) — a stage with one mind has no shared context to factor out; write it into the brief`,
      )
    }
    stages.push(stage)
  }
  if (stages.length === 0) throw new HookError("stages table is empty — remove it or declare [[stage]] entries")
  return stages
}

// Stages compile to the fan-out core (issue #152): units for the
// workers, steps for the wave machinery (the chain), and a grade plan
// for #150's binding. A chain was always the workflow's job.
const stageWave = (index: number): string => `stage-${index}`

export function unitsFromStages(stages: Stage[]): Unit[] {
  const units: Unit[] = []
  for (const stage of stages) {
    if (stage.topology === "solo") units.push({ id: stage.id, brief: stage.brief! })
    if (stage.topology === "fan-out") {
      // preamble = the roster's shared context: each unit's effective
      // brief is preamble + its own entry
      const pre = stage.preamble ? `${stage.preamble}\n\n` : ""
      units.push(...stage.units!.map((u) => ({ id: u.id, brief: `${pre}${u.brief}` })))
    }
  }
  // zero units is LEGAL: a chain of gates, exchanges, and experiments
  // needs no briefed worker of its own — the rail-acted steps drive it
  return units
}

export function stepsFromStages(stages: Stage[]): Step[] {
  const steps: Step[] = []
  for (const [index, stage] of stages.entries()) {
    const wave = stageWave(index)
    if (stage.topology === "gate") {
      steps.push({ id: stage.id, finished_by: "gate", wave, check: stage.run })
      continue
    }
    if (stage.topology === "coworker" || stage.topology === "lab") {
      // the exchange/experiment is delegated: the child program lives
      // at stages/<id>/ (minted by the orchestrator) and the wake
      // machinery levies it once at the frontier — the child's wake
      // receipt settles this stage like any wake step; an optional
      // stage check runs after the receipt as the stage's own verdict
      steps.push({
        id: stage.id,
        finished_by: "wake",
        wave,
        folder: join("stages", stage.id),
        ...(stage.check ? { check: stage.check } : {}),
      })
      continue
    }
    // one end-step per unit, all on the stage's wave: the wave gate
    // binds every unit, not just the first
    const ids = stage.topology === "fan-out" ? stage.units!.map((u) => u.id) : [stage.id]
    for (const id of ids) steps.push({ id, finished_by: "end", wave })
  }
  return steps
}

// DRY-RUN: worker_kind = "mock" births no agent. The unit's done line
// lands synchronously next to its brief and the cycle settles it
// through the real path — checks, gates, grades all fire. Rehearse a
// whole program's shape in seconds, zero tokens. (The test suite's
// fake ports have done this for years; now real runs can too.)
export function landMockUnit(briefPath: string, workerName: string): string {
  const dir = dirname(briefPath)
  const id = workerName.startsWith("w-") ? workerName.slice(2) : workerName
  writeFileSync(join(dir, "result.md"), "DRY-RUN: no agent was spawned\n")
  writeFileSync(join(dir, "log.txt"), `done ${id}\n`)
  return join(dir, "log.txt")
}

export function gradePlanFromStages(stages: Stage[]): Map<string, GradePlan> {
  const unitStages = stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => stage.topology === "solo" || stage.topology === "fan-out")
  const lastIndex = unitStages[unitStages.length - 1]?.index
  const plan = new Map<string, GradePlan>()
  for (const { stage, index } of unitStages) {
    // default binding (#150's mental model): the LAST unit stage carries
    // the task verifier; earlier stages run their own check if declared,
    // else finish on the worker's word. grade = true/false overrides.
    const task = stage.grade === true || (stage.grade !== false && index === lastIndex)
    const ids = stage.topology === "fan-out" ? stage.units!.map((u) => u.id) : [stage.id]
    for (const id of ids) {
      plan.set(id, task ? { grade: "task" } : stage.check ? { grade: "check", check: stage.check } : { grade: "none" })
    }
  }
  return plan
}

export type Manifest = {
  workflow: { name: string; worker_kind: "opencode" | "pi" | "mock"; slots?: number; model?: string; spur_id?: string; drain_timeout_ms?: number; canary?: boolean; retry?: number }
  // ADR 0014: hooks.units is refused at load, never set; the field stays
  // for coworker-run's defense until slice 2 folds that file
  hooks: { units?: string; grade?: string; counts?: string }
  detectors?: { signal?: string; end?: string }
  gates?: Record<string, string>
  stages?: Stage[]
  report?: { where?: string }
  layout?: Partial<Layout>
}

// Per-mind model pins compiled from stages (the #152 seam widening):
// a mind's pin = its NEAREST declaration — unit.model → stage.model.
// Absent from the map = fall to the manifest pin (byte-identical to
// the pre-stage rail). Fresh per stage: no inheritance from earlier
// stages, ever.
export function modelPlanFromStages(stages: Stage[]): Map<string, string> {
  const pins = new Map<string, string>()
  for (const stage of stages) {
    if (stage.topology === "solo") {
      if (stage.model) pins.set(stage.id, stage.model)
    } else if (stage.topology === "fan-out") {
      for (const unit of stage.units ?? []) {
        const pin = unit.model ?? stage.model
        if (pin) pins.set(unit.id, pin)
      }
    }
  }
  return pins
}

export function resolvedLayout(manifest: Manifest): Layout {
  const layout = manifest.layout ?? {}
  if (layout.tab !== undefined && layout.tab !== "same" && layout.tab !== "new") {
    throw new HookError(`layout.tab must be same or new: ${layout.tab}`)
  }
  if (
    layout.orchestrator !== undefined &&
    layout.orchestrator !== "left" &&
    layout.orchestrator !== "right"
  ) {
    throw new HookError(`layout.orchestrator must be left or right: ${layout.orchestrator}`)
  }
  return {
    tab: layout.tab ?? "new",
    orchestrator: layout.orchestrator ?? "left",
  }
}

export class HookError extends Error {}

// Hook-run telemetry (issue #40): every units/grade/counts execution is
// reported through the installed note — status, target, duration — so
// the trace (and the window) can say when a hook last fired, not just
// that it exists. The rail installs the note; nothing here knows jobs.
export type HookRunNote = {
  hook: "units" | "grade" | "counts"
  target?: string
  status: number
  ms: number
}
let noteHookRun: ((note: HookRunNote) => void) | null = null
export function setHookRunNote(fn: ((note: HookRunNote) => void) | null): void {
  noteHookRun = fn
}
function note(note: HookRunNote): void {
  try {
    noteHookRun?.(note)
  } catch {
    // telemetry never breaks the hook
  }
}

// A grade hook that runs an official verifier can take minutes under
// load — the tb2 rehearsal (2026-10-14) measured ~45s solo and ~2min
// with two verifiers in parallel under Rosetta, exactly on the old hard
// 120s ceiling: a killed grade hook throws mid-cycle and takes the
// whole run with it. AGENTIC_OS_HOOK_TIMEOUT_MS overrides (min 1s, max
// 1h); the default keeps a real guardrail above the measured worst
// case.
const DEFAULT_HOOK_TIMEOUT_MS = 300_000
function hookTimeoutMs(): number {
  const raw = Number(process.env.AGENTIC_OS_HOOK_TIMEOUT_MS ?? "")
  if (Number.isFinite(raw) && raw >= 1_000) return Math.min(raw, 3_600_000)
  return DEFAULT_HOOK_TIMEOUT_MS
}
const SHEP_SAFE_ID = /^[a-z][a-z0-9_-]{0,31}$/

export function loadManifest(taskDir: string, warn?: (message: string) => void): Manifest {
  const path = join(taskDir, "workflow.toml")
  if (!existsSync(path)) throw new HookError(`no workflow.toml in ${taskDir}`)
  let raw: unknown
  try {
    raw = parseToml(readFileSync(path, "utf8"))
  } catch (cause) {
    throw new HookError(`workflow.toml is not valid TOML: ${cause}`)
  }
  const m = raw as Record<string, Record<string, unknown>>
  const workflow = m.workflow ?? {}
  const hooks = m.hooks ?? {}
  const report = m.report ?? {}
  const layoutRaw = m.layout ?? {}
  const detectorsRaw = m.detectors ?? {}
  const gatesRaw = m.gates ?? {}
  const tab = layoutRaw.tab
  const side = layoutRaw.orchestrator
  if (tab !== undefined && tab !== "same" && tab !== "new") {
    throw new HookError(`layout.tab must be same or new: ${tab}`)
  }
  if (side !== undefined && side !== "left" && side !== "right") {
    throw new HookError(`layout.orchestrator must be left or right: ${side}`)
  }
  const name = str(workflow.name, "workflow.name")
  const workerKind = str(workflow.worker_kind, "workflow.worker_kind")
  if (workerKind !== "opencode" && workerKind !== "pi" && workerKind !== "mock") {
    throw new HookError(
      `workflow.worker_kind must be opencode, pi, or mock (dry-run: no agent is born; checks/gates/grades still fire): ${workerKind}`,
    )
  }
  let slots: number | undefined
  if (workflow.slots !== undefined) {
    slots = Number(workflow.slots)
    if (!Number.isInteger(slots) || slots < 1 || slots > 9) {
      throw new HookError(`workflow.slots must be an integer 1-9: ${workflow.slots}`)
    }
  }
  let drainTimeoutMs: number | undefined
  if (workflow.drain_timeout_ms !== undefined) {
    drainTimeoutMs = Number(workflow.drain_timeout_ms)
    if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1_000 || drainTimeoutMs > 3_600_000) {
      throw new HookError(`workflow.drain_timeout_ms must be an integer 1000-3600000 (ms): ${workflow.drain_timeout_ms}`)
    }
  }
  // Issue #122 — transport retry policy: how many times a member whose
  // pane dies mid-exchange (process crash, killed TTY — the clear
  // transport class) is respawned from its booked session before the
  // death is honest. Semantic outcomes (a stop, a capped stall) are
  // never retried — a failure should be an answer, never an accident.
  let retry: number | undefined
  if (workflow.retry !== undefined) {
    retry = Number(workflow.retry)
    if (!Number.isInteger(retry) || retry < 0 || retry > 3) {
      throw new HookError(`workflow.retry must be an integer 0-3: ${workflow.retry}`)
    }
  }
  // The fan-out canary is program policy, not an env accident: a bench
  // where a failed task is a measured outcome declares canary = false
  // (no solo first unit, no run stop on its first fail) beside its
  // slots; the door still lets AGENTIC_OS_CANARY override either way.
  let canary: boolean | undefined
  if (workflow.canary !== undefined) {
    if (typeof workflow.canary !== "boolean") {
      throw new HookError(`workflow.canary must be true or false: ${String(workflow.canary)}`)
    }
    canary = workflow.canary
  }
  let model: string | undefined
  if (workflow.model !== undefined) {
    model = str(workflow.model, "workflow.model")
    if (!/^[^/\s]+\/[^/\s]+$/.test(model)) {
      throw new HookError(`workflow.model must be provider/model: ${model}`)
    }
  }
  // ADR 0009: the manifest key renames dag_id -> spur_id. spur_id wins
  // when both are present; a legacy-only dag_id still resolves, loudly.
  const SPUR_ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
  let spurId: string | undefined
  if (workflow.spur_id !== undefined) {
    spurId = str(workflow.spur_id, "workflow.spur_id")
    if (!SPUR_ID_RE.test(spurId)) {
      throw new HookError(`workflow.spur_id must be url-safe lowercase: ${spurId}`)
    }
  } else if (workflow.dag_id !== undefined) {
    spurId = str(workflow.dag_id, "workflow.dag_id")
    if (!SPUR_ID_RE.test(spurId)) {
      throw new HookError(`workflow.dag_id must be url-safe lowercase: ${spurId}`)
    }
    warn?.("legacy dag_id in workflow.toml — rename to spur_id")
  }
  const detectors: { signal?: string; end?: string } = {}
  const optCmd = (value: unknown, field: string): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== "string" || value.length === 0) {
      throw new HookError(`${field} must be a command string: ${String(value)}`)
    }
    return value
  }
  const signal = optCmd(detectorsRaw.signal, "detectors.signal")
  const end = optCmd(detectorsRaw.end, "detectors.end")
  if (signal !== undefined) detectors.signal = signal
  if (end !== undefined) detectors.end = end
  const gates: Record<string, string> = {}
  for (const [id, value] of Object.entries(gatesRaw)) {
    const cmd = optCmd(value, `gates.${id}`)
    if (cmd !== undefined) gates[id] = cmd
  }
  const stages = stagesFromRaw(m.stage)
  // ADR 0014 — one authoring story: [[step]] and the units-hook
  // quick-mint are retired, refused with a pointer at [[stage]];
  // issue #152's mutual refusal is now the one-way refusal.
  if (m.step !== undefined) {
    throw new HookError("[[step]] tables are retired — declare [[stage]] entries instead: the chain is stages, and topology (solo | fan-out | coworker | gate | lab) carries what finished_by used to spell (docs/STAGES.md, ADR 0014)")
  }
  if (hooks.units !== undefined) {
    throw new HookError('hooks.units is retired — a program declares its workers as [[stage]] entries (solo brief / fan-out units), never mints them at runtime (docs/STAGES.md, ADR 0014)')
  }
  return {
    workflow: { name, worker_kind: workerKind, slots, model, ...(spurId ? { spur_id: spurId } : {}), drain_timeout_ms: drainTimeoutMs, ...(retry !== undefined ? { retry } : {}), ...(canary !== undefined ? { canary } : {}) },
    hooks: {
      grade: optHook(hooks.grade, "hooks.grade"),
      counts: optHook(hooks.counts, "hooks.counts", {
        refuseNoop:
          'hooks.counts = "true" prints nothing — a counts hook must print a JSON object of numbers; omit the line for the built-in counter, or use counts = "default" (issue #120, j-64e035)',
      }),
    },
    detectors: signal !== undefined || end !== undefined ? detectors : undefined,
    gates: Object.keys(gates).length > 0 ? gates : undefined,
    stages,
    report: report.where ? { where: str(report.where, "report.where") } : {},
    layout: {
      tab: tab as "same" | "new" | undefined,
      orchestrator: side as "left" | "right" | undefined,
    },
  }
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HookError(`workflow.toml is missing ${field}`)
  }
  return value
}

// Hooks are optional (issue #120): omitted means the built-in default —
// counts counts the scorecard, grade always passes; the workers come
// from [[stage]] (ADR 0014 — the units hook is refused at load). The
// explicit token "default" spells the same thing for authors who want
// it visible. The shell no-ops are refused for counts — /bin/true
// prints nothing, and a counts hook that prints nothing is a
// deterministic report-time fatal that costs the whole run (j-64e035:
// 79 minutes of work, then aborted).
const HOOK_NOOP_CMDS = new Set(["true", "false", ":"])
function optHook(value: unknown, field: string, opts: { refuseNoop?: string } = {}): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) {
    throw new HookError(`workflow.toml is missing ${field}`)
  }
  if (value === "default" && opts.refuseDefault) throw new HookError(opts.refuseDefault)
  if (HOOK_NOOP_CMDS.has(value) && opts.refuseNoop) throw new HookError(opts.refuseNoop)
  return value
}

function runHook(
  cmd: string,
  taskDir: string,
  opts: { timeoutMs?: number } = {},
): { stdout: string; status: number; stderr: string; ms: number } {
  const timeoutMs = opts.timeoutMs ?? hookTimeoutMs()
  const startedAt = Date.now()
  try {
    const stdout = execSync(cmd, {
      cwd: taskDir,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { stdout: stdout ?? "", status: 0, stderr: "", ms: Date.now() - startedAt }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number; killed?: boolean; signal?: string; code?: string }
    // Node surfaces a timed-out spawnSync as error ETIMEDOUT with killed
    // NOT always set (j-5701b2: "fatal: spawnSync /bin/sh ETIMEDOUT" —
    // the raw error escaped and aborted a whole run whose verifier was
    // a second from passing). Any kill shape is a hook timeout.
    if (e.killed || e.signal || e.code === "ETIMEDOUT") {
      throw new HookError(`hook timed out after ${timeoutMs}ms: ${cmd}`)
    }
    if (typeof e.status !== "number") throw err
    return { stdout: e.stdout ?? "", status: e.status, stderr: e.stderr ?? "", ms: Date.now() - startedAt }
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function runGrade(taskDir: string, manifest: Manifest, unit: Unit): Grade {
  // Omitted or "default" = always-pass (issue #120): the same outcome
  // the old grade = "true" spelling produced, now sanctioned and
  // self-documenting instead of a lucky accident of empty output.
  if (manifest.hooks.grade === undefined || manifest.hooks.grade === "default") {
    return { pass: true, row: "ok" }
  }
  const cmd = `${manifest.hooks.grade} ${quote(unit.id)}`
  const first = runHook(cmd, taskDir)
  note({ hook: "grade", target: unit.id, status: first.status, ms: first.ms })
  const firstRow = first.stdout.split("\n")[0]?.trim() ?? ""
  if (first.status === 0) return { pass: true, row: firstRow || "ok" }
  // A failing grade must SAY why (its first stdout line is the verdict
  // row). Silence + non-zero = the hook itself is broken — not-found
  // path, dead container, race — an infra fault, never an answer fault
  // (#144: the arm-e night, 28/33 "canary-stops" were exit-127s with
  // zero artifacts wearing answer-failure labels). One immediate retry
  // catches the warm-container race; a persistent fault keeps a label
  // that can never be confused for a verdict.
  if (firstRow) return { pass: false, row: firstRow }
  const retry = runHook(cmd, taskDir)
  note({ hook: "grade", target: unit.id, status: retry.status, ms: retry.ms })
  const retryRow = retry.stdout.split("\n")[0]?.trim() ?? ""
  if (retry.status === 0) return { pass: true, row: `${retryRow || "ok"} (after grade-fault retry)` }
  const why =
    retryRow || retry.stderr.split("\n").find((line) => line.trim()) || `exit ${retry.status}`
  return { pass: false, row: `grade-fault: ${why}`.slice(0, 200), fault: "grade-fault" }
}

// Admission smoke (#144): a grade hook that declares a --check mode is
// executed ONCE at booking time — before the run, not two seconds after
// the worker finishes. Opt-in by the hook's own source mentioning
// --check (an old hook without the mode simply runs as before). A
// refusal carries the check's own output: the operator sees exactly
// which contract leg failed (TASK_ID, verifier path, tests dir).
export function gradeSmoke(
  taskDir: string,
  manifest: Manifest,
): { kind: "skip" } | { kind: "pass" } | { kind: "refuse"; output: string } {
  const cmd = manifest.hooks.grade
  if (cmd === undefined || cmd === "default") return { kind: "skip" }
  // resolve the script path the way stageRun absolutizes: "bash <path> args…"
  const tokens = cmd.split(/\s+/)
  const script = tokens[0] === "bash" || tokens[0] === "sh" ? tokens[1] : tokens[0]
  if (!script) return { kind: "skip" }
  const scriptPath = resolve(taskDir, script)
  if (!existsSync(scriptPath)) return { kind: "skip" }
  if (!readFileSync(scriptPath, "utf8").includes("--check")) return { kind: "skip" }
  const { stdout, status } = runHook(`${cmd} --check`, taskDir, { timeoutMs: 10_000 })
  if (status === 0) return { kind: "pass" }
  const output = stdout.split("\n").filter((line) => line.trim()).slice(0, 6).join("\n")
  return { kind: "refuse", output: output || `grade --check exited ${status}` }
}

export function runCounts(
  taskDir: string,
  manifest: Manifest,
  table: CountRow[],
): Record<string, number> {
  const tablePath = join(taskDir, "table.json")
  // pass rides the scorecard (issue #120) so a counting hook — and the
  // built-in counter — can count outcomes, not just rows
  writeFileSync(tablePath, JSON.stringify(table))
  // Omitted or "default" = the built-in counter (issue #120): the j-64e035
  // class of bug (a silent counts command) cannot exist when the rail
  // itself does the counting
  const cmd = manifest.hooks.counts
  if (cmd === undefined || cmd === "default") {
    note({ hook: "counts", status: 0, ms: 0 })
    return builtinCounts(table)
  }
  const { stdout, status, ms } = runHook(`${cmd} ${quote(tablePath)}`, taskDir)
  note({ hook: "counts", status, ms })
  if (status !== 0) throw new HookError(`counts hook exited ${status}: ${cmd}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new HookError(`counts hook did not print JSON: ${stdout.slice(0, 80)}`)
  }
  const counts: Record<string, number> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "number") {
      throw new HookError(`counts hook count ${name} is not a number: ${value}`)
    }
    counts[name] = value
  }
  return counts
}

// Detectors: the program names where the photograph comes from; the
// rail still decides. Same contract as every hook — exit 75 = the
// provider refused (the rail retries), anything else is deterministic.
export function runSignalDetector(taskDir: string, manifest: Manifest): LiveSignal {
  const cmd = manifest.detectors?.signal
  if (!cmd) throw new HookError("no signal detector in workflow.toml")
  const { stdout, status, stderr } = runHook(cmd, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || "signal detector exited 75")
  if (status !== 0) throw new HookError(`signal detector exited ${status}: ${cmd}`)
  // a detector that prints nothing has nothing to say yet — no signal
  if (stdout.trim() === "") return { kind: "missing" }
  return parseSignal(stdout)
}

export function runEndDetector(taskDir: string, manifest: Manifest, unitId: string): string | null {
  const cmd = manifest.detectors?.end
  if (!cmd) throw new HookError("no end detector in workflow.toml")
  const { stdout, status, stderr } = runHook(`${cmd} ${quote(unitId)}`, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || "end detector exited 75")
  if (status !== 0) throw new HookError(`end detector exited ${status}: ${cmd}`)
  const line = stdout.split("\n")[0]?.trim() ?? ""
  if (line === "") return null
  if (line === "done" || line === "blocked" || line === "dead") return line
  throw new HookError(`end detector must print done, blocked, dead, or nothing: ${line.slice(0, 60)}`)
}

export function runGateDetector(taskDir: string, manifest: Manifest, gateId: string): boolean {
  const cmd = manifest.gates?.[gateId]
  if (!cmd) throw new HookError(`no [gates] ${gateId} detector in workflow.toml`)
  const { stdout, status, stderr } = runHook(cmd, taskDir)
  if (status === 75) throw new RefusedError(stderr.split("\n")[0]?.trim() || `gate ${gateId} exited 75`)
  if (status !== 0) throw new HookError(`gate ${gateId} detector exited ${status}: ${cmd}`)
  return stdout.split("\n")[0]?.trim() === "done"
}

export function hooksFromDir(taskDir: string): { hooks: Hooks; manifest: Manifest } {
  const manifest = loadManifest(taskDir)
  return {
    manifest,
    hooks: {
      // ADR 0014: the workers are the stages; stage-less is a refusal
      units: manifest.stages?.length
        ? () => unitsFromStages(manifest.stages)
        : () => {
            throw new HookError("no [[stage]] entries — a program declares its workers as stages (docs/STAGES.md, ADR 0014)")
          },
      grade: (unit) => runGrade(taskDir, manifest, unit),
      counts: (table) => runCounts(taskDir, manifest, table),
      workerKind: manifest.workflow.worker_kind,
    },
  }
}

// The staging probe (issue #121): grammar-check the hooks this run will
// actually call, on sample inputs, BEFORE anything is booked or born.
// j-64e035 proved a hook that cannot speak the protocol is invisible
// until the worst moment — 79 minutes of clean work, then a fatal at
// report time. The probe costs milliseconds and refuses at the door,
// where the fix costs one line of toml instead of a rerun. Refusals
// speak: each names the hook, the offending output, and the fix.
// AGENTIC_OS_PROBE=0 disarms; AGENTIC_OS_PROBE_TIMEOUT_MS tunes the
// per-hook ceiling (default 10s — counters and unit listers are fast;
// a hook that slow at probe time is itself a finding).
export function probeHooks(
  taskDir: string,
  manifest: Manifest,
): string[] {
  if (process.env.AGENTIC_OS_PROBE === "0") return []
  const refusals: string[] = []
  const probeDir = mkdtempSync(join(tmpdir(), "agentic-os-probe-"))
  try {
    const countsCmd = manifest.hooks.counts
    if (countsCmd !== undefined && countsCmd !== "default") {
      const tablePath = join(probeDir, "table.json")
      writeFileSync(tablePath, JSON.stringify([{ unit: "probe", result: "ok", pass: true }]))
      let stdout = ""
      let status = 0
      try {
        ;({ stdout, status } = runHook(`${countsCmd} ${quote(tablePath)}`, taskDir, { timeoutMs: probeTimeoutMs() }))
      } catch (err) {
        refusals.push(`counts hook did not survive the probe: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (status !== 0) {
        refusals.push(`counts hook exited ${status} at probe: ${countsCmd}`)
      } else if (refusals.length === 0) {
        try {
          const parsed = JSON.parse(stdout) as unknown
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            refusals.push(
              `counts hook must print a JSON object of numbers at probe (got ${JSON.stringify(parsed).slice(0, 60)}) — omit the line for the built-in counter, or use counts = "default"`,
            )
          } else {
            const obj = parsed as Record<string, unknown>
            const bad = Object.entries(obj).find(([, v]) => typeof v !== "number")
            if (bad) {
              refusals.push(`counts hook count ${bad[0]} is not a number (${JSON.stringify(bad[1])}) — a counts hook must print a JSON object of numbers`)
            } else if (Object.keys(obj).length === 0) {
              refusals.push('counts hook printed an empty object at probe — count something, omit the line for the built-in counter, or use counts = "default"')
            }
          }
        } catch {
          refusals.push(
            `counts hook prints no JSON at probe (${stdout.slice(0, 80) || "empty stdout"}) — omit the line for the built-in counter, or use counts = "default" (issue #121)`,
          )
        }
      }
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
  return refusals
}

function probeTimeoutMs(): number {
  const raw = Number(process.env.AGENTIC_OS_PROBE_TIMEOUT_MS ?? "")
  if (Number.isFinite(raw) && raw >= 1_000) return Math.min(raw, 60_000)
  return 10_000
}

export type ManifestOrigin = "local" | "env" | "user-global" | "builtin"

export function resolveManifestPath(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): { path: string; origin: ManifestOrigin } | null {
  const local = join(cwd, "workflow.toml")
  if (existsSync(local)) return { path: local, origin: "local" }
  if (env.AGENTIC_OS_WORKFLOW && existsSync(env.AGENTIC_OS_WORKFLOW)) {
    return { path: resolve(env.AGENTIC_OS_WORKFLOW), origin: "env" }
  }
  if (env.AGENTIC_OS_GLOBAL === "0") return null
  // ADR 0011: the global manifest lives in ~/.config/whitehartlane/;
  // a legacy ~/.config/agentic-os/workflow.toml is still honored.
  const nextGlobal = join(env.HOME ?? "", ".config", "whitehartlane", "workflow.toml")
  if (existsSync(nextGlobal)) return { path: nextGlobal, origin: "user-global" }
  const userGlobal = join(env.HOME ?? "", ".config", "agentic-os", "workflow.toml")
  if (existsSync(userGlobal)) return { path: userGlobal, origin: "user-global" }
  const builtin = join(REPO_DIR, "global", "workflow.toml")
  if (existsSync(builtin)) return { path: builtin, origin: "builtin" }
  return null
}
