export type WakeRow = { id: number; label: string; kind: string; payload: string }

export function parseWakeList(text: string): WakeRow[] {
  const rows: WakeRow[] = []
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("id\t") || line.startsWith("wake:")) continue
    const [id, label, kind, ...rest] = line.split("\t")
    const payload = rest.join("\t")
    const parsed = Number(id)
    if (!Number.isInteger(parsed) || !label || !kind) continue
    rows.push({ id: parsed, label, kind, payload })
  }
  return rows
}

export function extractReportPath(payload: string): string | null {
  const match = payload.match(/report: (\S*report\.json)/)
  return match ? match[1] : null
}
