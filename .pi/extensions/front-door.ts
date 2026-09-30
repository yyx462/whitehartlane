// The agentic-os front door, as a pi extension.
// A task typed here is routed by jev: fan-out stands up panes and ends in
// a report; direct makes this chat the worker. shep owns the panes.
// Routing happens in the stand_up tool (model path) and the /standup
// command (deterministic path — no model judgment involved).
import { execFile, spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { nextRetryAction, show } from "../../src/front-door.ts"
import { hooksFromDir, loadManifest, resolveManifestPath } from "../../src/hooks.ts"
import { admitDirect, admitFanOut } from "../../src/policy.ts"
import {
  appendEvent,
  createJob,
  findOrOpenSession,
  jobRunDir,
  listJobs,
  materializeRunDir,
  openSession,
  writeWorkerPermissions,
  type SessionRecord,
} from "../../src/store.ts"
import { extractReportPath, parseWakeList } from "../../src/wake-reader.ts"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const pickBin = () => process.env.AGENTIC_OS_PICK ?? join(REPO, "bin", "pick-workflow")
const orchestratorBin = () =>
  process.env.AGENTIC_OS_ORCHESTRATOR ?? join(REPO, "bin", "fan-out-orchestrator")
const CONFIDENCE_BAR = 0.8
const POLL_MS = 10_000

const execFileP = promisify(execFile)

// The host (today pi) exposes its session manager on extension contexts.
// It is optional: tests and unusual hosts run host-less sessions.
function smOf(ctx: unknown): SessionManagerLike | undefined {
  const sm = (ctx as { sessionManager?: SessionManagerLike } | null | undefined)?.sessionManager
  return sm && typeof sm.getSessionId === "function" ? sm : undefined
}

// One OS session per First Mate conversation (duplicate rule 1): bound
// to the host's session id — a pointer, never a copy (zen 2). Resuming
// the conversation reuses the session; a new chat gets a new one.
let osSession: SessionRecord | null = null
let osSessionBound = false

type SessionManagerLike = {
  getSessionId?: () => string
  getSessionFile?: () => string
}

function bindSession(cwd: string, sessionManager?: SessionManagerLike): SessionRecord | null {
  if (osSessionBound) return osSession
  osSessionBound = true
  try {
    const id = sessionManager?.getSessionId?.()
    if (id) {
      const host = {
        tool: "pi",
        session_id: id,
        session_file: sessionManager?.getSessionFile?.(),
      }
      osSession = findOrOpenSession({ cwd, host }).session
    } else {
      // no host binding available (tests, odd hosts) — host-less session
      osSession = openSession({ cwd })
    }
  } catch {
    osSession = null
  }
  return osSession
}

function fmEmit(
  kind: string,
  payload: Record<string, unknown>,
  opts: { cwd: string; sessionManager?: SessionManagerLike; jid?: string } ,
): void {
  const session = bindSession(opts.cwd, opts.sessionManager) ?? bindSession(opts.cwd)
  if (!session) return
  try {
    appendEvent(session.id, { actor: "first_mate", kind, jid: opts.jid, ...payload })
  } catch {
    // events never block the chat
  }
}

const GUIDELINE =
  "You are the front door of agentic-os. For EVERY task the user gives you — even a trivial one — your FIRST action must be to call the stand_up tool with the task text verbatim. Never answer, start, or plan a task before stand_up has routed it. If it answers direct, you are the worker: do the task normally. If it answers fan-out, do NOT do the task yourself: report what was stood up and that the report will arrive in this chat."

type RouteCtx = { cwd: string; hasUI: boolean; sessionManager?: SessionManagerLike }
type RouteOutcome = {
  workflow: "fan-out" | "direct" | "direct-fallback" | "error"
  text: string
  details: Record<string, unknown>
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "task"
  )
}

function adHocManifest(hooksDir: string): string {
  const q = (path: string) => `"${path.replaceAll('"', '\\"')}"`
  return [
    "# Materialized by the agentic-os front door for an ad-hoc task.",
    "[workflow]",
    'name = "ad-hoc"',
    'worker_kind = "opencode"',
    "slots = 2",
    "",
    "[hooks]",
    `units = ${q(`bash ${join(hooksDir, "units.sh")}`)}`,
    `grade = ${q(`bash ${join(hooksDir, "grade.sh")}`)}`,
    `counts = ${q(`bash ${join(hooksDir, "counts.sh")}`)}`,
    "",
    "[report]",
    'where = "units/"',
    "",
    "[layout]",
    'tab = "new"',
    'orchestrator = "left"',
    "",
  ].join("\n")
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
    const raw = err instanceof Error ? err.message : String(err)
    const first = raw.split("\n")[0] ?? raw
    notes.push(`jev unavailable (${first.slice(0, 120)})`)
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

  fmEmit("route", { decision: choice, confidence, task: task.slice(0, 120) }, ctx)

  if (choice !== "fan-out") {
    fmEmit("admit", { workflow: "direct", task: task.slice(0, 120) }, ctx)
    return {
      workflow: "direct",
      text: `direct — this chat is the worker.${notes.length ? ` (${notes.join("; ")})` : ""}`,
      details: { workflow: "direct" },
    }
  }

  try {
    // Resolve a manifest: a local workflow.toml runs as a snapshot; any
    // other origin is materialized ad-hoc. Either way the run lives on
    // the session disk — never in <cwd>/.agentic-os.
    let manifestPath: string | null = null
    let builtinAdHoc = false
    if (existsSync(join(ctx.cwd, "workflow.toml"))) {
      manifestPath = join(ctx.cwd, "workflow.toml")
    } else {
      const resolved = resolveManifestPath(ctx.cwd)
      if (!resolved) {
        fmEmit("reject", { workflow: "fan-out", why: `no workflow.toml resolves in ${ctx.cwd}` }, ctx)
        return {
          workflow: "direct-fallback",
          text: `cannot fan-out: no workflow.toml in ${ctx.cwd} and no global default. This task runs direct.`,
          details: { workflow: "direct-fallback" },
        }
      }
      manifestPath = resolved.path
      // the builtin default carries relative hook commands — it gets its
      // own hooks copy and absolute commands below
      builtinAdHoc = resolved.origin === "builtin"
    }

    const session = bindSession(ctx.cwd, ctx.sessionManager) ?? bindSession(ctx.cwd)
    let runDir: string | null = null
    let jid: string | undefined
    if (session) {
      try {
        const job = createJob({ sid: session.id, stoodUpBy: "first_mate", workflow: "fan-out", task, runDir: true })
        runDir = job.dir
        jid = job.id
      } catch {
        // no Job record — the run still works, it just is not booked
      }
    }
    runDir ??= join(ctx.cwd, ".agentic-os-fallback", `${Date.now()}-${slugify(task)}`)

    if (manifestPath && !builtinAdHoc) {
      materializeRunDir(runDir, task, manifestPath)
    } else {
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, "task.txt"), `${task}\n`)
      const hooksSrc = join(dirname(manifestPath ?? ""), "hooks")
      const hooksDir = join(runDir, "hooks")
      if (existsSync(hooksSrc)) cpSync(hooksSrc, hooksDir, { recursive: true })
      writeFileSync(join(runDir, "workflow.toml"), adHocManifest(hooksDir))
      writeWorkerPermissions(runDir)
    }

    const { hooks } = hooksFromDir(runDir)
    const manifest = loadManifest(runDir)
    const units = manifest.workflow.name === "ad-hoc" ? [] : hooks.units()

    // JEV (zen 1): the model proposed fan-out; policy admits or
    // rejects before any pane is born.
    const admission = admitFanOut({
      manifestResolved: true,
      slots: manifest.workflow.slots ?? (Number(process.env.AGENTIC_OS_SLOTS ?? "") || 2),
    })
    if (!admission.admit) {
      fmEmit("reject", { workflow: "fan-out", why: admission.why ?? "policy rejected" }, { ...ctx, jid })
      return {
        workflow: "direct-fallback",
        text: `cannot fan-out: ${admission.why}. This task runs direct.`,
        details: { workflow: "direct-fallback" },
      }
    }
    if (jid) fmEmit("admit", { workflow: "fan-out", task: task.slice(0, 120) }, { ...ctx, jid })

    const env: Record<string, string> = { ...process.env }
    if (session && jid) {
      env.AGENTIC_OS_SID = session.id
      env.AGENTIC_OS_JID = jid
    }
    try {
      const scope = (await execFileP("shep", ["scope"])).stdout
      const match = scope.match(/^scope:\s+(\S+)/m)
      if (match) env.SHEP_SCOPE = match[1]
    } catch {
      // outside herdr the orchestrator will resolve its own scope
    }

    const logPath = join(runDir, "orchestrator.log")
    await new Promise<void>((res, rej) => {
      const child = spawn(
        "bash",
        ["-c", `nohup '${orchestratorBin()}' '${runDir}' > '${logPath}' 2>&1 &`],
        { detached: true, stdio: "ignore", env },
      )
      child.on("error", rej)
      child.unref()
      res()
    })

    const stoodUp = manifest.workflow.name === "ad-hoc"
      ? `stood up: fan-out (ad-hoc) — the planner will decompose the task into units and panes will open in herdr. Run directory: ${runDir}. The report will arrive in this chat when the workflow finishes.`
      : `stood up: fan-out — ${units.length} units (${units.map((unit) => unit.id).join(", ")}), worker kind ${hooks.workerKind}. Panes are opening in herdr; the report will arrive in this chat when the workflow finishes.`
    return {
      workflow: "fan-out",
      text: `${stoodUp}${notes.length ? ` (${notes.join("; ")})` : ""}`,
      details: {
        workflow: "fan-out",
        adHoc: manifest.workflow.name === "ad-hoc",
        units: manifest.workflow.name === "ad-hoc" ? undefined : units.length,
        runDir,
        jid,
      },
    }
  } catch (err) {
    fmEmit("reject", { workflow: "fan-out", why: `stand-up failed: ${err instanceof Error ? err.message : String(err)}` }, ctx)
    return {
      workflow: "error",
      text: `fan-out stand-up failed: ${err instanceof Error ? err.message : String(err)}. This task runs direct.`,
      details: { workflow: "error" },
    }
  }
}

// A builtin-global manifest carries relative hook commands ("bash
// units.sh") that must be grounded into the run's own hooks copy.

export default function (pi: ExtensionAPI) {
  let wakeTimer: ReturnType<typeof setInterval> | null = null
  let resubmits = 0
  let routed = false

  pi.registerFlag("route", {
    description:
      "Route the prompt through agentic-os before any model turn (deterministic; jev decides)",
    type: "boolean",
  })

  pi.on("before_agent_start", async (event, ctx) => {
    resubmits = 0
    if (!event.systemPromptOptions.promptGuidelines.includes(GUIDELINE)) {
      event.systemPromptOptions.promptGuidelines.push(GUIDELINE)
    }
    // The guideline is advisory; --route is the deterministic path. The
    // extension routes the prompt itself: fan-out suppresses the model
    // turn (fixed echo system prompt), direct lets the chat be the worker.
    if (
      !routed &&
      pi.getFlag("route") === true &&
      typeof event.prompt === "string" &&
      event.prompt.trim()
    ) {
      routed = true
      const outcome = await routeTask(event.prompt, {
        cwd: ctx?.cwd ?? process.cwd(),
        hasUI: ctx?.hasUI ?? false,
        sessionManager: smOf(ctx),
      })
      if (outcome.workflow === "fan-out") {
        await pi.sendMessage({
          customType: "agentic-os-route",
          content: outcome.text,
          display: true,
        })
        return {
          systemPrompt: `You already routed this task via agentic-os and a fan-out workflow was stood up. Reply with exactly the text between the markers and nothing else:\n<<<\n${outcome.text}\n>>>`,
        }
      }
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
    // Bind this conversation to its OS session before anything routes
    // (duplicate rule 1: find-or-create keyed on the host session id).
    bindSession(ctx.cwd, smOf(ctx))
    if (wakeTimer) return
    wakeTimer = setInterval(() => {
      pollWakes(pi, ctx.cwd).catch(() => {})
      announceOrphans(pi).catch(() => {})
    }, POLL_MS)
  })

  pi.on("session_shutdown", async () => {
    if (wakeTimer) {
      clearInterval(wakeTimer)
      wakeTimer = null
    }
  })

  pi.registerCommand("jobs", {
    description: "List Jobs on the OS disk with state, units, panes, and receipt",
    handler: async (_args, ctx) => {
      let table: string
      try {
        const jobs = listJobs()
        table =
          jobs.length === 0
            ? "no Jobs on the OS disk"
            : [
                "job       state    stood up by           units     panes   outcome                      dir",
                ...jobs.map((job) => {
                  const born = job.panes.length
                  const dead = job.panes.filter((p) => p.died).length
                  const outcome = job.receipt
                    ? `receipt: ${job.receipt.panesRemaining} left, ${job.receipt.unitsDone ?? "?"} done`
                    : job.abort
                      ? `aborted: ${job.abort.reason}`
                      : job.orphan
                        ? `orphaned: ${job.orphan.reason} — relaunch?`
                        : "in flight"
                  return [
                    job.id.padEnd(10),
                    job.state.padEnd(8),
                    `${job.workflow} by ${job.stoodUpBy}`.padEnd(22),
                    `p ${dead}/${born}`.padEnd(8),
                    outcome.padEnd(28),
                    job.dir,
                  ].join(" ")
                }),
              ].join("\n")
      } catch (err) {
        table = `cannot read the OS disk: ${err instanceof Error ? err.message : String(err)}`
      }
      await pi.sendMessage({ customType: "agentic-os-jobs", content: table, display: true })
      ctx.ui?.notify?.("Jobs listed", "info")
    },
  })

  pi.registerCommand("standup", {
    description: "Route a task through agentic-os deterministically (jev picks the workflow)",
    handler: async (args, ctx) => {
      const task = (args ?? "").trim()
      if (!task) {
        ctx.ui?.notify?.("usage: /standup <task>", "warning")
        return
      }
      const outcome = await routeTask(task, { cwd: ctx.cwd, hasUI: ctx.hasUI, sessionManager: smOf(ctx) })
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
      routed = true
      const outcome = await routeTask(params.task, {
        cwd: ctx.cwd,
        hasUI: ctx.hasUI,
        sessionManager: smOf(ctx),
      })
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

async function pollWakes(pi: ExtensionAPI, cwd: string): Promise<void> {
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
  fmEmit("wake.consumed", { through: maxId }, { cwd })
}

// The relaunch queue is ask-first, announced on the periodic check —
// never a wake (zen 4: no immediate answer owed) and never repeated
// for the same generation of the same Job.
const announcedOrphans = new Set<string>()

async function announceOrphans(pi: ExtensionAPI): Promise<void> {
  let jobs
  try {
    jobs = listJobs()
  } catch {
    return
  }
  for (const job of jobs) {
    if (job.state !== "orphaned") continue
    const key = `${job.id}#${job.relaunches ?? 0}`
    if (announcedOrphans.has(key)) continue
    announcedOrphans.add(key)
    await pi.sendMessage({
      customType: "agentic-os-orphan",
      content: [
        `Job ${job.id} orphaned (${job.orphan?.reason ?? "orchestrator gone"}) — parked, awaiting your call.`,
        `relaunch: agentic-os relaunch ${job.id} | decline: agentic-os abort ${job.id}`,
      ].join("\n"),
      display: true,
    })
  }
}
