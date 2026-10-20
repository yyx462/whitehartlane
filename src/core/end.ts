import { appendEvent, readEvents, type OsEvent } from "../adapters/store.ts"

export type EndName = "done" | "blocked" | "dead" | "silent"

export function nameEnd(obs: {
  id: string
  log: string
  alive: boolean
  grew: boolean
  silentMs: number
  stallMs: number
  reprompted: boolean
}): EndName | null {
  if (obs.log.includes(`done ${obs.id}`)) return "done"
  if (obs.log.includes(`blocked ${obs.id}`)) return "blocked"
  if (!obs.alive) return "dead"
  if (obs.grew) return null
  if (obs.reprompted && obs.silentMs > obs.stallMs) return "silent"
  return null
}

export function recordEnd(
  sid: string,
  jid: string,
  pane: string,
  name: EndName | null,
): OsEvent | null {
  if (!name) return null
  const prior = readEvents(sid).filter((event) => event.kind === "end" && event.pane === pane)
  if (prior.length > 0) return null
  return appendEvent(sid, { actor: "rail", kind: "end", jid, pane, end: name })
}
