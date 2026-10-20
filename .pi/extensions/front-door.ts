// The agentic-os chat door, as a pi extension — passive by design.
// The chat is a Direct worker and a wake reader: it binds its OS
// session, delivers wakes (reports) into the conversation, announces
// orphaned Jobs, lists Jobs, and caps error-turn retries. It does NOT
// stand Jobs up — standing up is the doors' work: `agentic-os run` and
// whl. (The stand_up tool, /standup, and --route routing lived here
// once; RAILS.md records the retirement — one door protocol, every
// agent enters through whl.)
import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { nextRetryAction, show } from "../../src/doors/front-door.ts"
import {
  appendEvent,
  findOrOpenSession,
  listJobs,
  openSession,
  type SessionRecord,
} from "../../src/adapters/store.ts"
import { extractReportPath, parseWakeList } from "../../src/adapters/wake-reader.ts"

const POLL_MS = 10_000
const execFileP = promisify(execFile)

// The host (today pi) exposes its session manager on extension contexts.
// It is optional: tests and unusual hosts run host-less sessions.
function smOf(ctx: unknown): SessionManagerLike | undefined {
  const sm = (ctx as { sessionManager?: SessionManagerLike } | null | undefined)?.sessionManager
  return sm && typeof sm.getSessionId === "function" ? sm : undefined
}

// One OS session per conversation (duplicate rule 1): bound to the
// host's session id — a pointer, never a copy (zen 2). Resuming the
// conversation reuses the session; a new chat gets a new one.
let osSession: SessionRecord | null = null
let boundHost: string | undefined

type SessionManagerLike = {
  getSessionId?: () => string
  getSessionFile?: () => string
}

function bindSession(cwd: string, sessionManager?: SessionManagerLike): SessionRecord | null {
  const id = sessionManager?.getSessionId?.()
  if (osSession && boundHost === id) return osSession
  if (osSession && !id && boundHost === undefined) return osSession
  try {
    if (id) {
      const host = {
        tool: "pi",
        session_id: id,
        session_file: sessionManager?.getSessionFile?.(),
      }
      osSession = findOrOpenSession({ cwd, host }).session
      boundHost = id
    } else {
      osSession = openSession({ cwd })
      boundHost = undefined
    }
  } catch {
    osSession = null
  }
  return osSession
}

function fmEmit(kind: string, payload: Record<string, unknown>, cwd: string): void {
  const session = bindSession(cwd)
  if (!session) return
  try {
    appendEvent(session.id, { actor: "first_mate", kind, ...payload })
  } catch {
    // events never block the chat
  }
}

export default function (pi: ExtensionAPI) {
  let wakeTimer: ReturnType<typeof setInterval> | null = null
  let resubmits = 0

  // Direct's retry surface: an error turn continues up to the cap, then
  // settles with a message. A turn that cannot continue is left alone.
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
    // Bind this conversation to its OS session before anything else
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
                        ? `orphaned: ${job.orphan.reason} — continue?`
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
  fmEmit("wake.consumed", { through: maxId }, cwd)
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
        `continue: agentic-os continue ${job.id} | decline: agentic-os abort ${job.id}`,
      ].join("\n"),
      display: true,
    })
  }
}
