// agentic-wake: the in-band wake spool's reader (ADR 0008).
// Managed by `whl plugin install` — this file is OWNED by the WhiteHartLane
// checkout and the installed copy is a SYMLINK to it, so a git pull
// updates the plugin. No second source, nothing to drift.
//
// The rail appends one JSON line per wake to
//   <os-home>/wake-spool/<session-id>/queue.jsonl
// (fs-only IPC — the writer half is src/wake-spool.ts). This plugin
// rides the opencode process that owns the levy's host session and
// turns rows into REAL user turns via ctx.session.prompt — the wake
// lands in the conversation, not in a terminal nobody reads. Rows are
// ADDRESSED by session id (the booked spawner pointer is the address —
// no claim file, no owner race). Proof of life: alive.json per session,
// written while the process holds it; the rail rings the doorbell only
// when it goes stale. At-least-once: the byte-offset watermark advances
// only after prompt accepts; a crash in between redelivers the same
// digest — safe by design.
//
// opencode v2 plugin API (v2.0.27, the installed binary): default
// export { id, setup(ctx) } — the v1 named-export/async-fn shape does
// not load on v2 (it sat dormant through the p10 era; this port is the
// fix). Hooks: ctx.tool.hook("execute.before") for membership, the
// ctx.event.subscribe() stream for idle/deleted, ctx.session.prompt()
// for delivery. Provenance of the v2 shape: gwt-ambient.js, the
// production-proven v2 plugin on this same machine.
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import os from "node:os"
import { join } from "node:path"

export const SPOOL_STALE_MS = 15 * 60 * 1000

export const osHome = () => process.env.AGENTIC_OS_HOME ?? join(os.homedir(), ".local", "share", "agentic-os")
export const spoolDirOf = (sid) => join(osHome(), "wake-spool", sid)

// pure: the rows of one spool file beyond a byte offset. The offset
// only ever advances past a newline, so slicing from it never splits a
// line; a torn tail (crash mid-append) waits for its newline before it
// counts; a malformed line is skipped but still consumed — one bad
// byte must not wedge the queue forever.
export function rowsBeyond(text, offset) {
  const rows = []
  let end = offset
  let i = offset
  while (i < text.length) {
    const nl = text.indexOf("\n", i)
    if (nl === -1) break
    const line = text.slice(i, nl)
    i = nl + 1
    if (line.trim()) {
      try { rows.push(JSON.parse(line)) } catch { /* consumed, skipped */ }
    }
    end = i
  }
  return { rows, end }
}

// pure: one turn's text — the wake digest the conversation receives.
export function digest(rows) {
  const lines = rows.map((r) => `- ${r.jid}: ${r.text}`)
  return ["[agentic-wake]", ...lines].join("\n")
}

// the door touch: a command naming the door means this session levied
// (or at least asked) — whl, the old agentic-os spelling, or the long
// door name. Membership is recall-first: a session only gets rows the
// rail explicitly addressed to it, so a stray match costs one
// heartbeat, never a misdelivery.
const DOOR_TOUCH = /\b(whl|agentic-os|whitehartlane)\b/

export default {
  id: "agentic-wake",
  async setup(ctx) {
    // dead plugins stay dead: a cleanup (reload, uninstall) must leave
    // every closure inert — a stale registration firing after its
    // plugin died would deliver from beyond the grave. The watermark
    // makes redelivery safe, but safety is not a license.
    let alive = true
    const dead = () => !alive
    // the sessions of THIS process that have touched the door — a levy
    // always runs `whl run` (or a door command) in the very turn that
    // books it, so that touch is the zero-config membership mark.
    // Heartbeats and delivery stay scoped to them: no spool dir noise
    // for sessions that never levied anything.
    const mine = new Set()

    const beat = () => {
      const now = Date.now()
      for (const sid of mine) {
        try {
          mkdirSync(spoolDirOf(sid), { recursive: true })
          writeFileSync(join(spoolDirOf(sid), "alive.json"), JSON.stringify({ pid: process.pid, at: now }))
        } catch { /* heartbeat is best effort */ }
      }
    }

    const deliverSession = async (sid) => {
      const dir = spoolDirOf(sid)
      const q = join(dir, "queue.jsonl")
      if (!existsSync(q)) return
      const offPath = join(dir, ".offset")
      let offset = 0
      try { offset = Number(readFileSync(offPath, "utf8")) || 0 } catch { /* first read */ }
      const { rows, end } = rowsBeyond(readFileSync(q, "utf8"), offset)
      if (!rows.length) return
      await ctx.session.prompt({
        sessionID: sid,
        text: digest(rows),
      })
      writeFileSync(offPath, String(end)) // accepted — advance only now (at-least-once)
    }

    let busy = false
    const deliver = async () => {
      if (busy || dead()) return
      busy = true
      try {
        for (const sid of mine) await deliverSession(sid)
      } catch { /* a failed prompt keeps the watermark: the next trigger retries */ } finally {
        busy = false
      }
    }

    // triggers: writer-side fs event (<100ms typical), the 30s tick
    // (heartbeat + disaster backstop — fs.watch is best-effort per the
    // Node docs), session.idle below (turn end reconciles), and the
    // tool hook itself (the touch turn delivers without waiting).
    const timer = setInterval(() => {
      try { beat(); deliver() } catch { /* never kill the host */ }
    }, 30_000)
    timer.unref?.()
    let watcher
    try {
      const root = join(osHome(), "wake-spool")
      mkdirSync(root, { recursive: true })
      watcher = watch(root, { recursive: true }, () => { try { deliver() } catch { /* retried on tick */ } })
      watcher.on("error", () => { /* the tick is the backstop */ })
    } catch { /* the tick is the backstop */ }

    // membership: any tool call whose input carries a door command.
    // Read the session id and command defensively — hook event shapes
    // moved between opencode versions, and membership must never break
    // a tool call.
    const toolReg = await ctx.tool.hook("execute.before", async (event) => {
      try {
        if (dead()) return
        const e = event ?? {}
        const input = e.input ?? {}
        const command = String(input.command ?? input.args?.command ?? "")
        if (!DOOR_TOUCH.test(command)) return
        const sid = e.sessionID ?? input.sessionID
        if (!sid || typeof sid !== "string") return
        mine.add(sid)
        beat()
        deliver()
      } catch { /* membership must never break a tool call */ }
    })

    // lifecycle: idle reconciles (a turn end may be the first quiet
    // moment after the rail queued a wake mid-turn); deleted forgets.
    // gwt-ambient proved this stream + cleanup shape on v2.
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          if (dead()) break
          const type = event?.type ?? ""
          const sid = event?.properties?.sessionID ?? event?.properties?.session?.id
          if (!sid || typeof sid !== "string") continue
          if (type === "session.idle") {
            if (mine.has(sid)) {
              beat()
              deliver()
            }
          } else if (type === "session.deleted") {
            mine.delete(sid)
          }
        } catch { /* events must never break a session */ }
      }
    })().catch(() => {})

    return () => {
      alive = false
      try { clearInterval(timer) } catch { /* best effort */ }
      try { watcher?.close() } catch { /* best effort */ }
      try { controller.abort() } catch { /* best effort */ }
      try { toolReg?.dispose?.() } catch { /* best effort */ }
    }
  },
}
