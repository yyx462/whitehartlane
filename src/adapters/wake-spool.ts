// The in-band wake spool, rail side (ADR 0008): the writer half of a
// fs-only IPC. One JSON line per wake, ADDRESSED per session — the
// booked spawner pointer {tool, session_id} is the address, so no
// claim file and no owner race can exist (the lesson taken from the
// shep prototype's wake queue, which delivered to whoever claimed).
// The reader is the agentic-wake opencode plugin (plugin/opencode-wake.js)
// riding the levy's own opencode process: it drains queue.jsonl into
// the conversation as a real turn. alive.json is that plugin's
// proof-of-life; stale or absent means nobody is listening in-band and
// the ladder falls to the doorbell exactly as before.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homeRoot } from "./store.ts"
import { SPOOL_STALE_MS } from "../../plugin/opencode-wake.js"

export type SpoolRow = {
  at: string
  to: string
  jid: string
  text: string
}

export function spoolDirOf(sessionId: string): string {
  return join(homeRoot(), "wake-spool", sessionId)
}

// fresh heartbeat = an opencode process is holding this session and
// would deliver a spooled row in-band
export function spoolAlive(sessionId: string, now = Date.now()): boolean {
  try {
    const a = JSON.parse(readFileSync(join(spoolDirOf(sessionId), "alive.json"), "utf8")) as { at?: unknown }
    return typeof a.at === "number" && now - (a.at as number) < SPOOL_STALE_MS
  } catch {
    return false
  }
}

// append one wake row; best effort — the ladder treats a miss as
// "not in-band" and falls through to the doorbell
export function appendSpoolWake(row: SpoolRow): boolean {
  try {
    mkdirSync(spoolDirOf(row.to), { recursive: true })
    appendFileSync(join(spoolDirOf(row.to), "queue.jsonl"), JSON.stringify(row) + "\n")
    return true
  } catch {
    return false
  }
}
