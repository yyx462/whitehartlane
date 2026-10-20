// ports/transport.ts — how panes are ADDRESSED (the multiplexer seam).
//
// The rail speaks panes; herdr is today's answer. A future transport
// (another multiplexer, an SSH fleet, distributed machines) implements
// THIS interface and the rail does not change. The verb set is the
// rail's actual usage (census: 31 call sites, pane/tab/agent verbs) —
// `exec` is the escape hatch for rail-owned sequences like the
// privilege sweep, whose send-keys choreography is rail logic, not
// transport logic.
export type CmdResult = { status: number | null; stdout: string; stderr: string }

export type PaneLayout = {
  area: { width: number; height: number }
  panes: { pane_id: string; rect: { x: number; y: number; width: number; height: number } }[]
}

export interface Transport {
  // raw CLI relay — args as the multiplexer expects them
  exec(...args: string[]): CmdResult
  // pane lifecycle
  splitPane(from: string, direction: string, cwd: string, ratio: number): string | null
  closePane(pane: string): void
  renamePane(pane: string, name: string): void
  layoutOf(pane: string): PaneLayout | null
  // tabs
  tabCreate(label: string, cwd: string, workspace: string | null): { root: string | null; tab: string | null; status: number }
  closeTab(tab: string): void
}
