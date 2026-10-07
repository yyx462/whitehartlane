import { readFileSync } from "node:fs"
import { protocolPath, type Wave } from "./protocol.ts"

export type LiveSignal = { kind: "missing" } | { kind: "partial" } | { kind: "stop" } | { kind: "wave"; wave: Wave }

export function parseSignal(raw: string): LiveSignal {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: "partial" }
  }
  if (!parsed || typeof parsed !== "object") return { kind: "partial" }
  if ((parsed as { stop?: unknown }).stop === true) return { kind: "stop" }
  const units = (parsed as { units?: unknown }).units
  if (!Array.isArray(units) || units.length === 0) return { kind: "partial" }
  const wave: Wave = { units: [] }
  for (const unit of units) {
    if (!unit || typeof unit !== "object") return { kind: "partial" }
    const id = (unit as { id?: unknown }).id
    const brief = (unit as { brief?: unknown }).brief
    if (typeof id !== "string" || !id.trim()) return { kind: "partial" }
    if (typeof brief !== "string" || !brief.trim()) return { kind: "partial" }
    wave.units.push({ id, brief })
  }
  return { kind: "wave", wave }
}

export function readSignal(dir: string): LiveSignal {
  let raw = ""
  try {
    raw = readFileSync(protocolPath(dir), "utf8")
  } catch {
    return { kind: "missing" }
  }
  return parseSignal(raw)
}

export type MockEnd = { id: string; end: string | null }

export function wakesFor(ends: MockEnd[], already: string[]): string[] {
  return ends
    .filter((row) => row.end === "blocked" && !already.includes(row.id))
    .map((row) => row.id)
}

export function waveClosed(ends: MockEnd[]): boolean {
  return ends.length > 0 && ends.every((row) => row.end !== null)
}

export function endOf(log: string, id: string, alive: boolean, ageMs: number): string | null {
  if (log.includes(`done ${id}`)) return "done"
  if (log.includes(`blocked ${id}`)) return "blocked"
  if (!alive && ageMs > 15_000) return "dead"
  return null
}
