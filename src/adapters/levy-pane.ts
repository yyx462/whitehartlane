// The levy pane (ADR 0008): the SECOND pane kind. Worker panes are
// born booked — a rail asked herdr to split them open for a Job. A
// levy pane is SELF-REGISTERED: the levy's own chat, running inside a
// herdr pane herdr already detects as an agent, volunteered once by
// `whl register --from <tool>:<session>` from inside that pane.
// HERDR_PANE_ID is the address; herdr's agent get is the aliveness
// oracle. The registry is the OS-side binding herdr cannot know on
// its own: which host session lives in which pane. Any door command
// run inside a registered pane renews it — living there + using the
// door is the heartbeat.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homeRoot } from "./store.ts"

export type LevyPane = {
  session_id: string
  tool: string
  pane: string
  cwd?: string
  at: string
}

function levyPanesRoot(): string {
  return join(homeRoot(), "levy-panes")
}

export function registerLevyPane(rec: LevyPane): void {
  mkdirSync(levyPanesRoot(), { recursive: true })
  writeFileSync(join(levyPanesRoot(), `${rec.session_id}.json`), JSON.stringify(rec, null, 2) + "\n")
}

export function levyPaneOf(sessionId: string): LevyPane | null {
  try {
    return JSON.parse(readFileSync(join(levyPanesRoot(), `${sessionId}.json`), "utf8")) as LevyPane
  } catch {
    return null
  }
}

// the pane a registration points at — for renewal-by-presence
export function levyPaneByPane(pane: string): LevyPane | null {
  for (const rec of allLevyPanes()) {
    if (rec.pane === pane) return rec
  }
  return null
}

export function allLevyPanes(): LevyPane[] {
  try {
    return readdirSync(levyPanesRoot())
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(levyPanesRoot(), f), "utf8")) as LevyPane)
      .filter((r) => r && typeof r.pane === "string")
  } catch {
    return []
  }
}
