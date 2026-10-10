import { hooksFromDir, type Hooks, type Manifest, type Unit } from "./hooks.ts"
import { writeReport, type Report } from "./report.ts"
import { finishUnit, writeUnitsSnapshot } from "./state.ts"

export type { Grade, Hooks, Unit } from "./hooks.ts"
export type { Report } from "./report.ts"

export type Judgment = {
  workflow: "fan-out" | "direct"
  confidence: number
}

export type Session = {
  kind: "session"
  chat: string[]
  blocked: () => void
}

const RETRY_CAP = 3

export type Ask = {
  kind: "ask"
}

export type Provider = {
  admit: (unit: Unit) => "ok" | "refused"
  probe: () => "ok" | "refused"
}

export type Waiting = {
  kind: "waiting"
  probe: () => Promise<void>
  report: () => Report
}

const CONFIDENCE_BAR = 0.8
const WORKERS_PER_TAB = 3

export type RetryAction =
  | { action: "continue" }
  | { action: "stop"; message: string }

export function nextRetryAction(resubmitsDone: number): RetryAction {
  if (resubmitsDone < RETRY_CAP) return { action: "continue" }
  return { action: "stop", message: "Stopped after 3 retries." }
}

export type Pane = { role: "orchestrator" | "worker"; lane: "orchestrator" | "workers"; tab: number }

export type Panes = {
  open: (pane: Pane) => void
}

export function fanOutShepPlan(input: {
  cwd: string
  workerKind: "opencode" | "pi"
  units: Unit[]
}): string[][] {
  const orch = [
    "shep", "spawn", "orchestrator",
    "--kind", "opencode",
    "--cwd", input.cwd,
    "--dir", "right",
    "--brief", `@${input.cwd}/orchestrator.brief.md`,
  ]
  const workers = input.units.map((unit) => [
    "shep", "spawn", `w-${unit.id}`,
    "--kind", input.workerKind,
    "--cwd", input.cwd,
    "--brief", `@${input.cwd}/${unit.id}.brief.md`,
  ])
  return [orch, ...workers]
}

export function show(report: Report): string {
  const counts = Object.entries(report.counts).map(([name, value]) => `${name}: ${value}`)
  const rows = report.table.map((row) => `${row.unit.padEnd(8)}${row.result}`)
  return [
    `status: ${report.status}`,
    ...counts,
    "",
    `${"unit".padEnd(8)}result`,
    ...rows,
    "",
    `check: ${report.where}`,
  ].join("\n")
}

export async function standUp(input: {
  task: string
  taskDir?: string
  cwd?: () => string
  jev: (task: string) => Promise<Judgment>
  hooks?: Hooks
  runWorker?: (unit: Unit) => void | Promise<void>
  startWorker?: () => void
  provider?: Provider
  panes?: Panes
  runShep?: (argv: string[]) => void
}): Promise<Report | Session | Ask | Waiting> {
  const taskDir = input.taskDir ?? (input.cwd ?? process.cwd)()
  const judgment = await input.jev(input.task)
  if (judgment.confidence < CONFIDENCE_BAR) return { kind: "ask" }
  if (judgment.workflow === "direct") {
    const chat: string[] = []
    let retries = 0
    const start = () => input.startWorker?.()
    start()
    return {
      kind: "session",
      chat,
      blocked: () => {
        if (retries >= RETRY_CAP) {
          if (!chat.includes("Stopped after 3 retries.")) {
            chat.push("Stopped after 3 retries.")
          }
          return
        }
        retries += 1
        start()
      },
    }
  }
  const loaded = input.hooks
    ? { hooks: input.hooks, manifest: undefined as Manifest | undefined }
    : hooksFromDir(taskDir)
  const hooks = loaded.hooks
  const units = hooks.units()
  const where = loaded.manifest?.report?.where ?? taskDir
  if (loaded.manifest) writeUnitsSnapshot(taskDir, units)
  if (input.runShep) {
    for (const argv of fanOutShepPlan({
      cwd: taskDir,
      workerKind: hooks.workerKind,
      units,
    })) {
      input.runShep(argv)
    }
  }
  if (input.panes) {
    input.panes.open({ role: "orchestrator", lane: "orchestrator", tab: 1 })
    units.forEach((_, worker) => {
      input.panes?.open({
        role: "worker",
        lane: "workers",
        tab: 1 + Math.floor(worker / WORKERS_PER_TAB),
      })
    })
  }
  const table: { unit: string; result: string; pass: boolean }[] = []
  let index = 0

  const take = async (from: number): Promise<number | "refused"> => {
    for (let i = from; i < units.length; i++) {
      const unit = units[i]
      if (input.provider && input.provider.admit(unit) === "refused") return "refused"
      if (input.runWorker) await input.runWorker(unit)
      const grade = hooks.grade(unit)
      table.push({ unit: unit.id, result: grade.row, pass: grade.pass })
      if (loaded.manifest) finishUnit(taskDir, unit.id, grade.pass)
      index = i + 1
    }
    return index
  }

  const report = (): Report =>
    writeReport(taskDir, where, table, hooks.counts)

  if ((await take(0)) === "refused") {
    return {
      kind: "waiting",
      probe: async () => {
        if (!input.provider || input.provider.probe() === "refused") return
        await take(index)
      },
      report,
    }
  }
  return report()
}
