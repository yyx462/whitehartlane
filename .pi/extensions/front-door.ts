// The agentic-os front door, as a pi extension.
// A task typed here is routed by jev: fan-out stands up panes and ends in
// a report; direct makes this chat the worker. shep owns the panes.
// Routing happens in the stand_up tool (model path) and the /standup
// command (deterministic path — no model judgment involved).
import { execFile, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { nextRetryAction, show } from "../../src/front-door.ts"
import { hooksFromDir } from "../../src/hooks.ts"
import { extractReportPath, parseWakeList } from "../../src/wake-reader.ts"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const pickBin = () => process.env.AGENTIC_OS_PICK ?? join(REPO, "bin", "pick-workflow")
const orchestratorBin = () =>
  process.env.AGENTIC_OS_ORCHESTRATOR ?? join(REPO, "bin", "fan-out-orchestrator")
const CONFIDENCE_BAR = 0.8
const POLL_MS = 10_000

const execFileP = promisify(execFile)

const GUIDELINE =
  "You are the front door of agentic-os. For EVERY task the user gives you — even a trivial one — your FIRST action must be to call the stand_up tool with the task text verbatim. Never answer, start, or plan a task before stand_up has routed it. If it answers direct, you are the worker: do the task normally. If it answers fan-out, do NOT do the task yourself: report what was stood up and that the report will arrive in this chat."

type RouteCtx = { cwd: string; hasUI: boolean }
type RouteOutcome = {
  workflow: "fan-out" | "direct" | "direct-fallback" | "error"
  text: string
  details: Record<string, unknown>
}

export async function routeTask(task: string, ctx: RouteCtx): Promise<RouteOutcome> {
  const taskDir = ctx.cwd
  let choice = "direct"
  let confidence = 0
  const notes: string[] = []

  try {
    const out = (await execFileP(pickBin(), ["--state", task])).stdout.trim()
    const match = out.match(/^(fan-out|direct)\s+([0-9.]+)$/)
    if (match) {
      choice = match[1]
      confidence = Number(match[2])
    } else {
      notes.push(`pick-workflow said: ${out}`)
    }
  } catch (err) {
    notes.push(`jev unavailable (${err instanceof Error ? err.message : String(err)})`)
  }

  if (confidence < CONFIDENCE_BAR) {
    let picked: string | undefined
    if (ctx.hasUI) {
      picked = await ctx.ui
        ?.select(
          `agentic-os: which workflow? (jev said ${choice} ${confidence.toFixed(2)})`,
          ["fan-out", "direct"],
        )
        .catch(() => undefined)
    }
    choice = picked ?? "direct"
    notes.push(`low confidence — ${picked ? "user picked" : "defaulted to"} ${choice}`)
  }

  if (choice !== "fan-out") {
    return {
      workflow: "direct",
      text: `direct — this chat is the worker.${notes.length ? ` (${notes.join("; ")})` : ""}`,
      details: { workflow: "direct" },
    }
  }

  try {
    if (!existsSync(join(taskDir, "workflow.toml"))) {
      return {
        workflow: "direct-fallback",
        text: `cannot fan-out: no workflow.toml in ${taskDir}. This task runs direct.`,
        details: { workflow: "direct-fallback" },
      }
    }
    const { hooks } = hooksFromDir(taskDir)
    const units = hooks.units()

    const env: Record<string, string> = { ...process.env }
    try {
      const scope = (await execFileP("shep", ["scope"])).stdout
      const match = scope.match(/^scope:\s+(\S+)/m)
      if (match) env.SHEP_SCOPE = match[1]
    } catch {
      // outside herdr the orchestrator will resolve its own scope
    }

    const logPath = join(taskDir, "orchestrator.log")
    await new Promise<void>((res, rej) => {
      const child = spawn(
        "bash",
        ["-c", `nohup '${orchestratorBin()}' '${taskDir}' > '${logPath}' 2>&1 &`],
        { detached: true, stdio: "ignore", env },
      )
      child.on("error", rej)
      child.unref()
      res()
    })

    const ids = units.map((unit) => unit.id).join(", ")
    return {
      workflow: "fan-out",
      text: `stood up: fan-out — ${units.length} units (${ids}), worker kind ${hooks.workerKind}. Panes are opening in herdr; the report will arrive in this chat when the workflow finishes.${notes.length ? ` (${notes.join("; ")})` : ""}`,
      details: { workflow: "fan-out", units: units.length },
    }
  } catch (err) {
    return {
      workflow: "error",
      text: `fan-out stand-up failed: ${err instanceof Error ? err.message : String(err)}. This task runs direct.`,
      details: { workflow: "error" },
    }
  }
}

export default function (pi: ExtensionAPI) {
  let wakeTimer: ReturnType<typeof setInterval> | null = null
  let resubmits = 0

  pi.on("before_agent_start", async (event) => {
    resubmits = 0
    if (!event.systemPromptOptions.promptGuidelines.includes(GUIDELINE)) {
      event.systemPromptOptions.promptGuidelines.push(GUIDELINE)
    }
  })

  pi.on("agent_before_settle", async (event) => {
    if (event.outcome !== "error") return
    if (event.context?.canContinue === false) return
    const next = nextRetryAction(resubmits)
    if (next.action === "continue") {
      resubmits += 1
      return { continue: true }
    }
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: "agentic-os-retry-cap",
          content: next.message,
          display: true,
        },
      ],
      continue: false,
    }
  })

  pi.on("session_start", async (_event, ctx) => {
    if (wakeTimer) return
    wakeTimer = setInterval(() => {
      pollWakes(pi, ctx.cwd).catch(() => {})
    }, POLL_MS)
  })

  pi.on("session_shutdown", async () => {
    if (wakeTimer) {
      clearInterval(wakeTimer)
      wakeTimer = null
    }
  })

  pi.registerCommand("standup", {
    description: "Route a task through agentic-os deterministically (jev picks the workflow)",
    handler: async (args, ctx) => {
      const task = (args ?? "").trim()
      if (!task) {
        ctx.ui?.notify?.("usage: /standup <task>", "warning")
        return
      }
      const outcome = await routeTask(task, { cwd: ctx.cwd, hasUI: ctx.hasUI })
      if (outcome.workflow === "fan-out") {
        await pi.sendMessage({
          customType: "agentic-os-route",
          content: outcome.text,
          display: true,
        })
        ctx.ui?.notify?.(outcome.text.slice(0, 100), "info")
        return
      }
      // direct (or fallback): warn, then continue — submit the task itself
      await pi.sendMessage({
        customType: "agentic-os-route",
        content: `${outcome.text} Submitting it as a direct message now.`,
        display: true,
      })
      ctx.ui?.notify?.(outcome.text.slice(0, 100), "warning")
      await pi.sendUserMessage(task)
    },
  })

  pi.registerTool({
    name: "stand_up",
    label: "Stand up a workflow",
    description:
      "Route a task to its agentic-os workflow. Call this FIRST for every user task, with the task text verbatim. It answers direct (you are the worker) or fan-out (panes are stood up; a report will arrive).",
    parameters: Type.Object({
      task: Type.String({ description: "The task, verbatim" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const outcome = await routeTask(params.task, { cwd: ctx.cwd, hasUI: ctx.hasUI })
      let text = outcome.text
      if (outcome.workflow === "direct" || outcome.workflow === "direct-fallback") {
        text += " Do the task now, normally."
      } else if (outcome.workflow === "fan-out") {
        text += " Do not do the task yourself."
      }
      return {
        content: [{ type: "text" as const, text }],
        details: outcome.details,
      }
    },
  })
}

async function pollWakes(pi: ExtensionAPI, _cwd: string): Promise<void> {
  const out = (await execFileP("shep", ["wake", "list"])).stdout
  const rows = parseWakeList(out)
  if (rows.length === 0) return
  let maxId = 0
  for (const row of rows) {
    maxId = Math.max(maxId, row.id)
    const lines = [`${row.label}/${row.kind}: ${row.payload}`]
    const reportPath = extractReportPath(row.payload)
    if (reportPath && existsSync(reportPath)) {
      try {
        const report = JSON.parse(readFileSync(reportPath, "utf8"))
        lines.push("", show(report))
      } catch {
        // the payload alone is enough
      }
    }
    await pi.sendMessage({
      customType: "agentic-os-wake",
      content: lines.join("\n"),
      display: true,
    })
  }
  await execFileP("shep", ["wake", "ack", "--through", String(maxId)])
}
