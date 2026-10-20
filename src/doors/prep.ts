// Prep hands the planner the compacted First Mate view, not the raw
// chat. A compaction summary replaces what it summarized. Decisions
// that never became code survive. The planner must not contradict them.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readEvents, type OsEvent, type SessionRecord } from "../adapters/store.ts"

type PiLine = {
  type?: string
  id?: string
  summary?: string
  firstKeptEntryId?: string
  message?: { role?: string; content?: unknown }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join("\n")
}

// Compacted view: the latest summary, plus messages kept after it.
// Text the summary replaced is omitted — that is the point.
export function compactedPi(jsonl: string): string {
  const lines = readFileSync(jsonl, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PiLine)
  let summary = ""
  let keptFrom = ""
  let cut = -1
  lines.forEach((line, i) => {
    if (line.type === "compaction" && line.summary) {
      summary = line.summary
      keptFrom = line.firstKeptEntryId ?? ""
      cut = i
    }
  })
  const kept: string[] = []
  for (let i = cut + 1; i < lines.length; i++) {
    const line = lines[i]
    if (keptFrom && line.id === keptFrom) keptFrom = ""
    if (line.type !== "message") continue
    const role = line.message?.role
    if (role !== "user" && role !== "assistant") continue
    const text = textOf(line.message?.content).trim()
    if (text) kept.push(`${role}: ${text}`)
  }
  return [summary && `summary:\n${summary}`, ...kept].filter(Boolean).join("\n\n")
}

export function traceContext(events: OsEvent[]): string {
  const lines: string[] = []
  for (const event of events) {
    if (event.kind === "grill" && event.enough === false && typeof event.task === "string") {
      lines.push(`grill asked more on: ${event.task}`)
    }
    if (event.kind === "job.born" && typeof event.task === "string") {
      lines.push(`earlier job: ${event.task}`)
    }
    if (event.kind === "unit.finished" && event.pass === false) {
      lines.push(`unit ${event.unit} failed: ${event.result}`)
    }
  }
  return lines.join("\n")
}

export function contextFor(session: SessionRecord | null, events: OsEvent[] = []): string {
  const parts: string[] = []
  const file = session?.host?.session_file
  if (file && existsSync(file)) {
    try {
      const compacted = compactedPi(file)
      if (compacted) parts.push(compacted)
    } catch {
      // a bad transcript must not block the run
    }
  }
  const trace = traceContext(events.length ? events : session ? readEvents(session.id) : [])
  if (trace) parts.push(trace)
  return parts.join("\n\n").slice(0, 4000)
}

export function writeRunContext(runDir: string, context: string): void {
  if (!context.trim()) return
  writeFileSync(join(runDir, "context.md"), `${context.trim()}\n`)
}
