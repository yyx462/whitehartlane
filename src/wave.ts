import type { LivePane } from "./live.ts"

export type WavePane = {
  id: string
  end: string | null
  trace?: { tool: string; cwd: string; since: string }
  result?: string
}

export function closeWave(
  live: LivePane,
  panes: WavePane[],
  port: {
    prompt: (paneId: string, text: string) => void
    store: (pane: WavePane) => void
  },
): boolean {
  if (panes.some((pane) => pane.end === null)) return false
  for (const pane of panes) port.store(pane)
  port.prompt(live.paneId, "wave closed")
  return true
}
