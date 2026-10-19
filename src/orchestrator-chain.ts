// The chain object — OPTIMUM §2's endgame slice (stated in #164's PR
// body: "one chain object with kind-specific step execution"). ONE
// owner of the wave order, the frontier predicate, unreachability,
// and the step-finish ceremony. Before this, orchestrator.ts walked
// the wave order three times — cycle's spawn gate, cycle's done
// condition, the driver's frontier trio — across four step machines
// (wave gating, check polling, stage gates, wake levies), each
// hand-rolling the same state read + frontier walk + settle/emit/row
// ceremony. The drift was already visible: cycle's `ready()` and the
// driver's `frontier()` were the same predicate written twice, and a
// finish was settle+emit+rows four different ways. The chain is
// declared once; the machines become kind-specific executors that
// ASK it (the walker lives in orchestrator.ts, next to the engines).
import type { Step } from "./hooks.ts"
import { settle } from "./state.ts"
import type { ReportRow } from "./report.ts"

export type Chain = {
  readonly steps: Step[]
  // waves in declaration order (table order IS the chain — L0 §3)
  readonly waveOrder: readonly string[]
  // the kind slices: what the walker executes, by finished_by
  readonly checks: readonly Step[] // ADR 0007 polling gates (debounced retry)
  readonly gates: readonly Step[] // stage gates — one-shot verdicts (#152)
  readonly wakes: readonly Step[] // levy + receipt steps (ADR 0007 stage 3)
  // every non-unit step: the done condition's filter
  readonly watched: readonly Step[]
  waveOf(id: string): string | undefined
  // the frontier predicate, ONE spelling: a wave is on the frontier
  // when every step of every EARLIER wave finished done. A failed or
  // unfinished prior both close it — failed additionally makes the
  // wave unreachable (never asked, never counted against finishing).
  frontier(wave: string, finished: Set<string>, failed: Set<string>): boolean
  // the spawn gate for a unit: open = its wave is on the frontier;
  // blockedBy names the failed prior step (for the honest row);
  // open false without a blocker = merely waiting on an earlier wave
  gateOf(id: string, finished: Set<string>, failed: Set<string>): { open: boolean; blockedBy?: string }
  // an unreachable step: some step of a prior wave failed
  unreachable(step: Step, failed: Set<string>): boolean
}

export function chainOf(steps: Step[] | undefined): Chain {
  const list = steps ?? []
  const waveOrder: string[] = []
  for (const s of list) if (!waveOrder.includes(s.wave)) waveOrder.push(s.wave)
  const waveOf = new Map(list.map((s) => [s.id, s.wave] as const))
  const byKind = (kind: Step["finished_by"]): Step[] => list.filter((s) => s.finished_by === kind)
  const priorsOf = (wave: string | undefined): string[] =>
    wave === undefined ? [] : waveOrder.slice(0, waveOrder.indexOf(wave))
  // one walk answers both questions: the first failed prior (the
  // blocker) and the first unfinished prior (waiting). A failed prior
  // wins — a wave behind a failure is unreachable, not late.
  const survey = (
    wave: string | undefined,
    finished: Set<string>,
    failed: Set<string>,
  ): { blockedBy?: string; waiting: boolean } => {
    for (const prior of priorsOf(wave)) {
      for (const s of list) {
        if (s.wave !== prior) continue
        if (failed.has(s.id)) return { blockedBy: s.id, waiting: false }
        if (!finished.has(s.id)) return { waiting: true }
      }
    }
    return { waiting: false }
  }
  return {
    steps: list,
    waveOrder,
    checks: byKind("check"),
    gates: byKind("gate"),
    wakes: byKind("wake"),
    watched: list.filter((s) => s.finished_by !== "end"),
    waveOf: (id) => waveOf.get(id),
    frontier: (wave, finished, failed) => {
      const s = survey(wave, finished, failed)
      return !s.waiting && s.blockedBy === undefined
    },
    gateOf: (id, finished, failed) => {
      const s = survey(waveOf.get(id), finished, failed)
      if (!s.blockedBy && !s.waiting) return { open: true }
      return s.blockedBy ? { open: false, blockedBy: s.blockedBy } : { open: false }
    },
    unreachable: (step, failed) => {
      for (const prior of priorsOf(step.wave)) {
        for (const s of list) {
          if (s.wave === prior && failed.has(s.id)) return true
        }
      }
      return false
    },
  }
}

// The finish ceremony, ONE spelling: one settle card (the unit
// ledger's only lifecycle store), one unit.finished event, one report
// row. Was hand-rolled per machine — the check/gate/wake loops and
// the deadline sweep each wired the three differently.
export type StepRecorder = (
  id: string,
  verb: "gate" | "wake" | "levy" | "deadline",
  pass: boolean,
  detail: string,
  row?: string,
) => void

export function stepRecorder(
  taskDir: string,
  emit: (kind: string, payload: Record<string, unknown>) => void,
  rows: ReportRow[],
): StepRecorder {
  return (id, verb, pass, detail, row) => {
    settle(taskDir, id, `${verb}:${id}`, pass, detail)
    const result = row ?? detail
    emit("unit.finished", { unit: id, pass, result })
    rows.push({ unit: id, result, pass })
  }
}
