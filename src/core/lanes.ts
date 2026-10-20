export const MAX_LANES = 3
export const MAX_PANES = 3

export type Lane = { role: string; panes: string[] }
export type Board = { tabs: { lanes: Lane[] }[] }

export function emptyBoard(): Board {
  return { tabs: [] }
}

export function laneCount(board: Board, tab = board.tabs.length - 1): number {
  return board.tabs[tab]?.lanes.length ?? 0
}

export function share(n: number): number {
  if (n < 1) return 1
  return 1 / n
}

const single = new Set(["orchestrator", "actor"])

export type Place =
  | { kind: "first"; tab: number; role: string }
  | { kind: "lane"; tab: number; role: string }
  | { kind: "stack"; tab: number; role: string; lane: number }
  | { kind: "have"; tab: number; role: string; lane: number }
  | { kind: "overflow-tab"; role: string }

export function place(board: Board, role: string): Place {
  const last = board.tabs.length - 1
  if (last < 0) return { kind: "first", tab: 0, role }
  const tab = board.tabs[last]
  const lane = tab.lanes.findIndex((row) => row.role === role)
  if (lane >= 0) {
    if (single.has(role)) return { kind: "have", tab: last, role, lane }
    if (tab.lanes[lane].panes.length < MAX_PANES) return { kind: "stack", tab: last, role, lane }
    return { kind: "overflow-tab", role }
  }
  if (tab.lanes.length < MAX_LANES) return { kind: "lane", tab: last, role }
  return { kind: "overflow-tab", role }
}

export function note(board: Board, placed: Place, pane: string): Board {
  const tabs = board.tabs.map((tab) => ({ lanes: tab.lanes.map((lane) => ({ ...lane, panes: [...lane.panes] })) }))
  if (placed.kind === "first" || placed.kind === "overflow-tab") {
    tabs.push({ lanes: [{ role: placed.role, panes: [pane] }] })
    return { tabs }
  }
  if (placed.kind === "lane") {
    tabs[placed.tab].lanes.push({ role: placed.role, panes: [pane] })
    return { tabs }
  }
  tabs[placed.tab].lanes[placed.lane].panes.push(pane)
  return { tabs }
}

export function drop(board: Board, pane: string): Board {
  const tabs = []
  for (const tab of board.tabs) {
    const lanes = []
    for (const lane of tab.lanes) {
      const panes = lane.panes.filter((id) => id !== pane)
      if (panes.length > 0) lanes.push({ role: lane.role, panes })
    }
    if (lanes.length > 0) tabs.push({ lanes })
  }
  return { tabs }
}
