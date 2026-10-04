import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type ProtocolUnit = { id: string; brief: string }
export type Wave = { units: ProtocolUnit[] }

export function protocolPath(dir: string): string {
  return join(dir, "protocol.json")
}

function complete(dir: string): Wave | null {
  const path = protocolPath(dir)
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const units = (parsed as { units?: unknown }).units
  if (!Array.isArray(units) || units.length === 0) return null
  const out: ProtocolUnit[] = []
  for (const unit of units) {
    if (!unit || typeof unit !== "object") return null
    const id = (unit as { id?: unknown }).id
    const brief = (unit as { brief?: unknown }).brief
    if (typeof id !== "string" || id.trim() === "") return null
    if (typeof brief !== "string" || brief.trim() === "") return null
    out.push({ id, brief })
  }
  return { units: out }
}

export function birthWave(
  dir: string,
  opts: { idle: boolean; spawn?: () => void },
): Wave | null {
  const wave = complete(dir)
  if (!wave) return null
  void opts
  writeFileSync(join(dir, "wave.json"), JSON.stringify(wave))
  return wave
}
