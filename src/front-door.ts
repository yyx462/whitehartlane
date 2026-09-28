import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type Judgment = {
  workflow: "fan-out" | "direct"
  confidence: number
}

export type Unit = { id: string; brief: string }

export type Grade = { pass: boolean; row: string }

export type Hooks = {
  units: () => Unit[]
  grade: (unit: Unit) => Grade
  counts: (rows: { unit: string; result: string }[]) => Record<string, number>
  workerKind: "opencode" | "pi"
}

export type Report = {
  kind: "report"
  status: "done" | "failed"
  counts: Record<string, number>
  table: { unit: string; result: string }[]
  where: string
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
  hooks: Hooks
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
  const units = input.hooks.units()
  if (input.runShep) {
    for (const argv of fanOutShepPlan({
      cwd: taskDir,
      workerKind: input.hooks.workerKind,
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

  const take = (from: number): number | "refused" => {
    for (let i = from; i < units.length; i++) {
      const unit = units[i]
      if (input.provider && input.provider.admit(unit) === "refused") return "refused"
      const grade = input.hooks.grade(unit)
      table.push({ unit: unit.id, result: grade.row, pass: grade.pass })
      index = i + 1
    }
    return index
  }

  const report = (): Report => {
    const body: Report = {
      kind: "report",
      status: table.some((row) => !row.pass) ? "failed" : "done",
      counts: input.hooks.counts(table),
      table: table.map(({ unit, result }) => ({ unit, result })),
      where: taskDir,
    }
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(join(taskDir, "report.json"), JSON.stringify(body, null, 2))
    return body
  }

  if (take(0) === "refused") {
    return {
      kind: "waiting",
      probe: async () => {
        if (!input.provider || input.provider.probe() === "refused") return
        take(index)
      },
      report,
    }
  }
  return report()
}
