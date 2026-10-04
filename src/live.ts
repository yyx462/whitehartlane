export type LivePane = { paneId: string }

export type LivePort = {
  spawnOrchestrator: () => string
  prompt: (paneId: string, text: string) => void
}

export function holdOrchestrator(
  port: LivePort,
  live: LivePane | null,
  text: string,
): LivePane {
  if (live) {
    port.prompt(live.paneId, text)
    return live
  }
  return { paneId: port.spawnOrchestrator() }
}
