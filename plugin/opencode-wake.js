// agentic-wake: the in-band wake spool's reader (ADR 0008).
// Managed by `whl plugin install` — this file is OWNED by the agentic-os
// checkout and the installed copy is a SYMLINK to it, so a git pull
// updates the plugin. No second source, nothing to drift.
//
// The rail appends one JSON line per wake to
//   <os-home>/wake-spool/<session-id>/queue.jsonl
// (fs-only IPC — the writer half is src/wake-spool.ts). This plugin
// rides the opencode process that owns the levy's host session and
// turns rows into REAL user-role turns via client.session.promptAsync
// — the wake lands in the conversation, not in a terminal nobody
// reads. Rows are ADDRESSED by session id (the booked spawner
// pointer is the address — no claim file, no owner race). Proof of
// life: alive.json per session, written while the process holds it;
// the rail rings the doorbell only when it goes stale. At-least-once:
// the byte-offset watermark advances only after promptAsync accepts;
// a crash in between redelivers the same digest — safe by design.
//
// Provenance: the mechanism is migrated from yyx-shep's wake plugin
// (fs queue + in-process plugin + promptAsync), which proved the path
// in production. The owner-claim is deliberately NOT migrated: shep
// had one shared queue delivered to whoever claimed; the spool is
// per-session, so the claim race cannot exist.
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

export const AgenticWake = async ({ client }) => {
  // the sessions of THIS process that have touched the door — a levy
  // always runs `whl run` (or an agentic-os command) in the very turn
  // that books it, so that touch is the zero-config membership mark.
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
    await client.session.promptAsync({
      path: { id: sid },
      body: { parts: [{ type: "text", text: digest(rows) }] },
    })
    writeFileSync(offPath, String(end)) // accepted — advance only now (at-least-once)
  }

  let busy = false
  const deliver = async () => {
    if (busy) return
    busy = true
    try {
      for (const sid of mine) await deliverSession(sid)
    } catch { /* a failed prompt keeps the watermark: the next trigger retries */ } finally {
      busy = false
    }
  }

  // triggers: writer-side fs event (<100ms typical), the 30s tick
  // (heartbeat + disaster backstop — fs.watch is best-effort per the
  // Node docs), and session.idle below (turn end reconciles).
  const timer = setInterval(() => {
    try { beat(); deliver() } catch { /* never kill the host */ }
  }, 30_000)
  timer.unref?.()
  try {
    const root = join(osHome(), "wake-spool")
    mkdirSync(root, { recursive: true })
    const w = watch(root, { recursive: true }, () => { try { deliver() } catch { /* retried on tick */ } })
    w.on("error", () => { /* the tick is the backstop */ })
  } catch { /* the tick is the backstop */ }

  return {
    "tool.execute.before": async (input, output) => {
      try {
        if (input.tool !== "bash") return
        const command = String(output?.args?.command ?? input.args?.command ?? "")
        if (!/\b(whl|agentic-os)\b/.test(command)) return
        mine.add(input.sessionID)
        beat()
        deliver()
      } catch { /* membership must never break a tool call */ }
    },
    event: async ({ event }) => {
      try {
        if (event.type === "session.idle") {
          beat()
          deliver()
        } else if (event.type === "session.deleted") {
          mine.delete(event.properties.sessionID)
        }
      } catch { /* events must never break a session */ }
    },
  }
}

export default AgenticWake
